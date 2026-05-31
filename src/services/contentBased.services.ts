import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả gợi ý từ Content-Based Filtering
export interface ContentBasedResult {
  twizz_id: ObjectId
  score: number // Cosine Similarity (0-1)
  reason: string
}

// Vector ý nghĩa: mảng 768 số thực
type SemanticVector = number[]

// Trọng số tín hiệu tương tác khi xây User Profile
const INTERACTION_WEIGHTS = {
  like: 1.0,
  comment: 1.2,
  quote: 1.5
}

// Chu kỳ bán rã cho Content-Based (7 ngày).
const CONTENT_DECAY_HALFLIFE_DAYS = 7

// Giới hạn trần tổng trọng số tương tác để tránh trơ vector sở thích
const MAX_WEIGHT_CAP = 100.0

// Khoảng thời gian định kỳ để tính toán lại toàn bộ lịch sử (7 ngày)
const RECALCULATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

class ContentBasedService {
  constructor() {
    // Đã loại bỏ RAM cache cục bộ để tối ưu bộ nhớ và tránh lỗi đồng bộ
  }

  /**
   * Lấy gợi ý bài viết dựa trên Semantic Content-Based Filtering.
   * Sử dụng Vector Embedding và MongoDB Atlas Vector Search.
   */
  async getRecommendations(userId: string, limit: number, externalExcludeIds?: Set<string>): Promise<ContentBasedResult[]> {
    recoLog('ContentBased', 'Bắt đầu getRecommendations (Semantic)', { userId, limit })

    // 1. Kiểm tra và tự động tính toán lại vector sở thích nếu đã quá hạn 7 ngày (Lazy Update)
    await this.checkAndRecalculateUserVector(userId)

    // 2. Lấy vector sở thích của User từ DB
    const user = await databaseService.users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { interest_vector: 1 } }
    )
    
    const userVector = user?.interest_vector || new Array(768).fill(0)

    // Nếu người dùng chưa từng tương tác (vector toàn 0), trả về rỗng để chuyển sang pool Trending/Following
    const isZeroVector = userVector.every((val) => val === 0)
    if (isZeroVector) {
      recoLog('ContentBased', 'Dừng: User chưa có vector sở thích (chưa tương tác)', { userId })
      return []
    }

    // 3. Lấy danh sách các bài viết đã tương tác để loại trừ khỏi gợi ý
    const interactedTwizzIds = await this.getInteractedTwizzIds(userId)

    // 4. Thực hiện Vector Search trên MongoDB Atlas
    const excludeIdsSet = new Set<string>()
    for (const id of interactedTwizzIds.keys()) {
      excludeIdsSet.add(id)
    }
    if (externalExcludeIds) {
      for (const id of externalExcludeIds) {
        excludeIdsSet.add(id)
      }
    }
    const excludeIds = Array.from(excludeIdsSet).map((id) => new ObjectId(id))
    const userObjectId = new ObjectId(userId)

    recoLog('ContentBased', 'Đang gọi Atlas Vector Search...', { userId })

    // Lấy pool rộng để không bỏ lỡ bài mới, sau đó re-rank theo thời gian
    const results = await databaseService.twizzs.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'content_vector',
          queryVector: userVector,
          numCandidates: limit * 10,
          limit: limit * 4,
          filter: {
            _id: { $nin: excludeIds },
            user_id: { $ne: userObjectId },
            type: { $in: [TwizzType.Twizz, TwizzType.QuoteTwizz] }
          }
        }
      },
      // Thêm thông tin tác giả để kiểm tra quyền truy cập Circle
      {
        $lookup: {
          from: 'users',
          localField: 'user_id',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: '$author' },
      {
        $match: {
          $or: [
            { audience: TwizzAudience.Everyone },
            {
              $and: [
                { audience: TwizzAudience.TwizzCircle },
                { 'author.twizz_circle': userObjectId }
              ]
            }
          ]
        }
      },
      // Tính toán Time Decay cho bài viết gợi ý
      {
        $addFields: {
          days_ago: {
            $divide: [{ $subtract: [new Date(), '$created_at'] }, 1000 * 60 * 60 * 24]
          },
          vectorScore: { $meta: 'vectorSearchScore' }
        }
      },
      {
        $addFields: {
          // Công thức: FinalScore = VectorScore * (Halflife / (Halflife + days_ago))
          decayedScore: {
            $multiply: [
              '$vectorScore',
              {
                $divide: [
                  CONTENT_DECAY_HALFLIFE_DAYS,
                  { $add: [CONTENT_DECAY_HALFLIFE_DAYS, '$days_ago'] }
                ]
              }
            ]
          }
        }
      },
      // Sắp xếp lại theo điểm đã suy giảm theo thời gian
      { $sort: { decayedScore: -1 } },
      { $limit: limit }
    ]).toArray()

    recoLog('ContentBased', 'Hoàn tất Vector Search + Time Decay', {
      userId,
      sốKếtQuả: results.length,
      halflife: CONTENT_DECAY_HALFLIFE_DAYS
    })

    return results.map((r) => ({
      twizz_id: r._id as ObjectId,
      score: r.decayedScore,
      reason: 'Dựa trên nội dung bạn quan tâm và độ mới'
    }))
  }

  /**
   * Kiểm tra xem vector sở thích của User đã quá hạn 7 ngày chưa.
   * Nếu đã quá hạn hoặc chưa có, tự động tính toán lại định kỳ (Lazy Update).
   */
  async checkAndRecalculateUserVector(userId: string): Promise<void> {
    const user = await databaseService.users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { interest_vector_updated_at: 1 } }
    )

    if (!user) return

    const now = new Date()
    const lastUpdate = user.interest_vector_updated_at

    // Kiểm tra xem đã qua 7 ngày chưa
    const isStale = !lastUpdate || (now.getTime() - lastUpdate.getTime() >= RECALCULATE_INTERVAL_MS)

    if (isStale) {
      recoLog('ContentBased', 'Lazy Update: Cập nhật định kỳ vector sở thích (7 ngày) từ lịch sử', { userId })
      try {
        await this.recalculateUserInterestVector(userId)
      } catch (err) {
        console.error(`Lỗi khi recalculate vector cho user ${userId}:`, err)
      }
    }
  }

  /**
   * Tính toán lại hoàn toàn Vector sở thích của người dùng dựa trên toàn bộ lịch sử tương tác kèm Time Decay.
   */
  async recalculateUserInterestVector(userId: string): Promise<void> {
    const userObjectId = new ObjectId(userId)

    // 1. Lấy toàn bộ lịch sử tương tác (Like, Comment, Quote) còn hiệu lực trong DB
    const [likes, comments, quotes] = await Promise.all([
      databaseService.likes.find({ user_id: userObjectId }).toArray(),
      databaseService.twizzs.find({ user_id: userObjectId, type: TwizzType.Comment }).toArray(),
      databaseService.twizzs.find({ user_id: userObjectId, type: TwizzType.QuoteTwizz }).toArray()
    ])

    // Nếu không có tương tác nào, reset vector về toàn số 0
    if (likes.length === 0 && comments.length === 0 && quotes.length === 0) {
      await databaseService.users.updateOne(
        { _id: userObjectId },
        {
          $set: {
            interest_vector: new Array(768).fill(0),
            total_interaction_weight: 0.0,
            interest_vector_updated_at: new Date()
          }
        }
      )
      return
    }

    const interactedMap = new Map<string, { weight: number; createdAt: Date }>()

    // Hàm helper tính toán Time Decay (Bán rã 7 ngày) cho từng tương tác
    const processInteraction = (twizzId: string, weightType: number, createdAt: Date) => {
      const daysAgo = (Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)
      const decayFactor = Math.pow(2, -daysAgo / CONTENT_DECAY_HALFLIFE_DAYS)
      const decayedWeight = weightType * decayFactor

      const existing = interactedMap.get(twizzId)
      if (!existing) {
        interactedMap.set(twizzId, { weight: decayedWeight, createdAt })
      } else {
        // Cộng gộp trọng số nếu có nhiều tương tác trên cùng một bài viết
        interactedMap.set(twizzId, {
          weight: existing.weight + decayedWeight,
          // Giữ mốc thời gian tương tác mới nhất để tính toán decay chuẩn xác hơn
          createdAt: createdAt > existing.createdAt ? createdAt : existing.createdAt
        })
      }
    }

    // Đổ dữ liệu tương tác vào Map và áp dụng Decay
    likes.forEach((l) => {
      if (l.created_at) processInteraction(l.twizz_id.toString(), INTERACTION_WEIGHTS.like, l.created_at)
    })
    comments.forEach((c) => {
      if (c.parent_id && c.created_at) {
        processInteraction(c.parent_id.toString(), INTERACTION_WEIGHTS.comment, c.created_at)
      }
    })
    quotes.forEach((q) => {
      if (q.parent_id && q.created_at) {
        processInteraction(q.parent_id.toString(), INTERACTION_WEIGHTS.quote, q.created_at)
      }
    })

    if (interactedMap.size === 0) return

    // 2. Lấy Vector nội dung của các bài viết đã tương tác
    const twizzIds = Array.from(interactedMap.keys()).map((id) => new ObjectId(id))
    const twizzs = await databaseService.twizzs
      .find({ _id: { $in: twizzIds }, content_vector: { $exists: true } })
      .project({ content_vector: 1 })
      .toArray()

    if (twizzs.length === 0) return

    // 3. Tính Trung bình cộng có trọng số (Weighted Mean)
    const vectorSum = new Array(768).fill(0)
    let totalWeight = 0

    for (const twizz of twizzs) {
      const interaction = interactedMap.get(twizz._id.toString())
      if (!interaction) continue

      const weight = interaction.weight
      const vector = twizz.content_vector as number[]

      for (let i = 0; i < 768; i++) {
        vectorSum[i] += vector[i] * weight
      }
      totalWeight += weight
    }

    if (totalWeight === 0) return

    // Chia cho tổng trọng số để lấy trung bình cộng
    const meanVector = vectorSum.map((val) => val / totalWeight)

    // Áp dụng Capping (Giới hạn trần tổng trọng số tương tác là 100.0)
    const cappedWeight = totalWeight > MAX_WEIGHT_CAP ? MAX_WEIGHT_CAP : totalWeight

    // 4. Cập nhật lại vào DB User
    await databaseService.users.updateOne(
      { _id: userObjectId },
      {
        $set: {
          interest_vector: meanVector,
          total_interaction_weight: cappedWeight,
          interest_vector_updated_at: new Date()
        }
      }
    )
  }

  /**
   * Cập nhật lũy tiến thời gian thực (Incremental Update) khi có tương tác mới.
   */
  async updateUserProfileIncremental(userId: string, twizzId: string, type: 'like' | 'comment' | 'quote'): Promise<void> {
    try {
      const userObjectId = new ObjectId(userId)

      // 1. Lấy vector nội dung của bài viết mới tương tác
      const twizz = await databaseService.twizzs.findOne(
        { _id: new ObjectId(twizzId) },
        { projection: { content_vector: 1 } }
      )
      if (!twizz || !twizz.content_vector) return

      const postVector = twizz.content_vector as number[]
      const interactionWeight = INTERACTION_WEIGHTS[type]

      // 2. Lấy vector sở thích và tổng trọng số hiện tại của User
      const user = await databaseService.users.findOne(
        { _id: userObjectId },
        { projection: { interest_vector: 1, total_interaction_weight: 1 } }
      )
      if (!user) return

      const userVector = user.interest_vector || new Array(768).fill(0)
      const totalWeight = user.total_interaction_weight || 0.0

      // 3. Tính toán Vector sở thích mới theo công thức cộng dồn lũy tiến
      const newWeight = totalWeight + interactionWeight
      const newVector = new Array(768).fill(0)
      for (let i = 0; i < 768; i++) {
        newVector[i] = (userVector[i] * totalWeight + postVector[i] * interactionWeight) / newWeight
      }

      // Áp dụng Weight Capping tối đa là 100.0
      const cappedWeight = newWeight > MAX_WEIGHT_CAP ? MAX_WEIGHT_CAP : newWeight

      // 4. Lưu lại vào DB
      await databaseService.users.updateOne(
        { _id: userObjectId },
        {
          $set: {
            interest_vector: newVector,
            total_interaction_weight: cappedWeight
          }
        }
      )
      
      recoLog('ContentBased', 'Cập nhật lũy tiến thành công (Real-time)', {
        userId,
        twizzId,
        type,
        newWeight: cappedWeight
      })
    } catch (err) {
      console.error('Lỗi trong quá trình cập nhật incremental vector:', err)
    }
  }

  /**
   * Lấy danh sách ID bài viết đã tương tác và gán trọng số (phục vụ lọc trùng)
   */
  public async getInteractedTwizzIds(userId: string): Promise<Map<string, number>> {
    const userObjectId = new ObjectId(userId)
    const interactionMap = new Map<string, number>()

    const [likes, comments, quotes] = await Promise.all([
      databaseService.likes.find({ user_id: userObjectId }).toArray(),
      databaseService.twizzs.find({ user_id: userObjectId, type: TwizzType.Comment }).toArray(),
      databaseService.twizzs.find({ user_id: userObjectId, type: TwizzType.QuoteTwizz }).toArray()
    ])

    likes.forEach((l) => interactionMap.set(l.twizz_id.toString(), INTERACTION_WEIGHTS.like))
    comments.forEach((c) => {
      if (c.parent_id) {
        const id = c.parent_id.toString()
        const current = interactionMap.get(id) || 0
        interactionMap.set(id, current + INTERACTION_WEIGHTS.comment)
      }
    })
    quotes.forEach((q) => {
      if (q.parent_id) {
        const id = q.parent_id.toString()
        const current = interactionMap.get(id) || 0
        interactionMap.set(id, current + INTERACTION_WEIGHTS.quote)
      }
    })

    return interactionMap
  }

  /**
   * Xóa cache vector của user (Hàm trống để tránh lỗi import ở các file khác)
   */
  invalidateUserCache(userId: string): void {
    // Không cần làm gì ở đây vì RAM cache đã bị loại bỏ hoàn toàn
  }
}

const contentBasedService = new ContentBasedService()
export default contentBasedService
