import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import { recoLog } from '~/utils/recommendationLogger'
import embeddingService from './embedding.services'

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

// Chu kỳ bán rã cho Content-Based (7 ngày). Sau 7 ngày, điểm similarity sẽ giảm đi một nửa.
const CONTENT_DECAY_HALFLIFE_DAYS = 7

class ContentBasedService {
  // Cache User Profile Vector (TTL: 1 giờ)
  private userProfileCache: Map<string, { vector: SemanticVector; expiredAt: number }>
  private readonly USER_PROFILE_TTL = 60 * 60 * 1000 // 1 giờ

  constructor() {
    this.userProfileCache = new Map()
  }

  /**
   * Lấy gợi ý bài viết dựa trên Semantic Content-Based Filtering.
   * Sử dụng Vector Embedding và MongoDB Atlas Vector Search.
   */
  async getRecommendations(userId: string, limit: number, externalExcludeIds?: Set<string>): Promise<ContentBasedResult[]> {
    recoLog('ContentBased', 'Bắt đầu getRecommendations (Semantic)', { userId, limit })

    // 1. Lấy danh sách bài đã tương tác để xây dựng Profile
    const interactedTwizzIds = await this.getInteractedTwizzIds(userId)
    if (interactedTwizzIds.size === 0) {
      recoLog('ContentBased', 'Dừng: chưa có tương tác nào', { userId })
      return []
    }

    // 2. Xây dựng Interest Vector (Tọa độ sở thích của User)
    const userVector = await this.buildUserProfile(userId, interactedTwizzIds)
    if (!userVector || userVector.length === 0) {
      recoLog('ContentBased', 'Dừng: không tạo được Interest Vector', { userId })
      return []
    }

    // 3. Thực hiện Vector Search trên MongoDB Atlas
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

    // Chúng ta lấy nhiều ứng viên hơn (numCandidates) để sau đó re-rank theo thời gian
    const results = await databaseService.twizzs.aggregate([
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'content_vector',
          queryVector: userVector,
          numCandidates: limit * 10, // Lấy pool rộng để không bỏ lỡ bài mới
          limit: limit * 4,           // Lấy dư ra để lọc Audience và tính decay
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
      // Tính toán Time Decay
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
   * Tính toán Interest Vector dựa trên trung bình cộng có trọng số của các bài đã tương tác.
   */
  private async buildUserProfile(userId: string, interactedTwizzIds: Map<string, number>): Promise<SemanticVector> {
    // 1. Kiểm tra cache
    const cached = this.userProfileCache.get(userId)
    if (cached && cached.expiredAt > Date.now()) {
      return cached.vector
    }

    // 2. Lấy Vector của các bài viết đã tương tác
    const twizzIds = Array.from(interactedTwizzIds.keys()).map((id) => new ObjectId(id))
    const twizzs = await databaseService.twizzs
      .find({ _id: { $in: twizzIds }, content_vector: { $exists: true } })
      .project({ content_vector: 1 })
      .toArray()

    if (twizzs.length === 0) return []

    // 3. Tính Trung bình cộng có trọng số (Weighted Mean)
    const vectorSum = new Array(768).fill(0)
    let totalWeight = 0

    for (const twizz of twizzs) {
      const weight = interactedTwizzIds.get(twizz._id.toString()) || 1.0
      const vector = twizz.content_vector as number[]

      for (let i = 0; i < 768; i++) {
        vectorSum[i] += vector[i] * weight
      }
      totalWeight += weight
    }

    // Chia cho tổng trọng số để lấy trung bình
    const meanVector = vectorSum.map((val) => val / totalWeight)

    // 4. Lưu cache và trả về
    this.userProfileCache.set(userId, {
      vector: meanVector,
      expiredAt: Date.now() + this.USER_PROFILE_TTL
    })

    // Cập nhật luôn vào DB User để dùng cho các mục đích khác sau này
    databaseService.users.updateOne(
      { _id: new ObjectId(userId) },
      { $set: { interest_vector: meanVector } }
    ).catch(err => console.error('Lỗi cập nhật interest_vector:', err))

    return meanVector
  }

  /**
   * Lấy danh sách ID bài viết đã tương tác và gán trọng số
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
   * Xóa cache vector của user.
   */
  invalidateUserCache(userId: string): void {
    recoLog('ContentBased', 'invalidateUserCache', { userId })
    this.userProfileCache.delete(userId)
  }
}

const contentBasedService = new ContentBasedService()
export default contentBasedService
