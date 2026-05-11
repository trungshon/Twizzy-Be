import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả gợi ý từ Collaborative Filtering
export interface CollaborativeResult {
  twizz_id: ObjectId
  score: number // Predicted rating đã normalize (0-1)
  reason: string
}

// Trọng số tín hiệu tương tác trong ma trận User-Item
const RATING_WEIGHTS = {
  like: 1.0,
  comment: 0.8, // Thấp hơn like vì có thể lặp nhiều lần, tránh thiên lệch ma trận
  quote: 1.2
}

// Số user tương tự tối đa (K trong KNN)
const TOP_K_USERS = 50

// Số tương tác chung tối thiểu để tính similarity
const MIN_COMMON_ITEMS = 5

class CollaborativeFilteringService {
  // Cache ma trận User-Item (TTL: 6 giờ)
  private userItemMatrixCache: {
    matrix: Map<string, Map<string, number>>
    expiredAt: number
  } | null

  // Cache user similarity (TTL: 6 giờ)
  private similarityCache: Map<
    string,
    { similarities: Array<{ userId: string; similarity: number }>; expiredAt: number }
  >

  private readonly MATRIX_TTL = 6 * 60 * 60 * 1000 // 6 giờ
  private readonly SIMILARITY_TTL = 6 * 60 * 60 * 1000 // 6 giờ

  constructor() {
    this.userItemMatrixCache = null
    this.similarityCache = new Map()
  }

  /**
   * Lấy gợi ý bài viết dựa trên Collaborative Filtering (User-User CF).
   * Dựa trên nguyên lý: "người có sở thích giống tôi thích gì, tôi cũng sẽ thích".
   */
  async getRecommendations(userId: string, limit: number): Promise<CollaborativeResult[]> {
    recoLog('CF', 'Bắt đầu getRecommendations', { userId, limit })

    // Xây dựng ma trận User-Item
    const userItemMatrix = await this.getOrBuildUserItemMatrix()
    if (userItemMatrix.size === 0) {
      recoLog('CF', 'Dừng: ma trận User-Item rỗng', { userId })
      return []
    }

    const userRow = userItemMatrix.get(userId)
    if (!userRow || userRow.size === 0) {
      recoLog('CF', 'Dừng: user không có dòng trong ma trận (chưa tương tác twizz nào)', {
        userId,
        cóTrongMatrix: userItemMatrix.has(userId),
        sốItem: userRow?.size ?? 0
      })
      return []
    }

    // Tính mean rating của user hiện tại (dùng cho normalization và dự đoán)
    const userMean = this.computeMean(userRow)

    recoLog('CF', 'User mean rating (raw matrix)', { userId, userMean, sốTwizzĐãTươngTác: userRow.size })

    // Tìm top K users tương tự
    const similarUsers = await this.findSimilarUsers(userId, userItemMatrix, userMean)
    if (similarUsers.length === 0) {
      recoLog('CF', 'Dừng: không tìm được user tương tự (common items < MIN hoặc similarity = 0)', {
        userId,
        MIN_COMMON_ITEMS
      })
      return []
    }

    recoLog('CF', 'Danh sách user tương tự (top K)', {
      userId,
      sốSimilar: similarUsers.length,
      similarityCaoNhất: similarUsers[0]?.similarity
    })

    // Lấy các bài viết candidate: bài mà similar users đã tương tác nhưng user hiện tại chưa
    const interactedTwizzIds = new Set(userRow.keys())
    const candidateTwizzIds = this.getCandidateTwizzIds(similarUsers, userItemMatrix, interactedTwizzIds)

    if (candidateTwizzIds.size === 0) {
      recoLog('CF', 'Dừng: không có candidate twizz từ similar users', { userId })
      return []
    }

    recoLog('CF', 'Candidate twizz từ similar users', { userId, sốCandidate: candidateTwizzIds.size })

    // Dự đoán rating cho từng candidate
    const predictions = this.predictRatings(userId, candidateTwizzIds, similarUsers, userItemMatrix, userMean)

    if (predictions.length === 0) {
      recoLog('CF', 'Dừng: predictRatings không cho kết quả', { userId })
      return []
    }

    recoLog('CF', 'Sau predictRatings', { userId, sốPrediction: predictions.length })

    // Lọc bài viết theo quyền truy cập
    const accessiblePredictions = await this.filterByAccessibility(userId, predictions)

    recoLog('CF', 'Sau filterByAccessibility', {
      userId,
      trước: predictions.length,
      sau: accessiblePredictions.length
    })

    // Chuẩn hóa điểm về [0, 1] và sắp xếp
    const normalized = this.normalizePredictions(accessiblePredictions)
    normalized.sort((a, b) => b.score - a.score)

    const out = normalized.slice(0, limit).map((p) => ({
      twizz_id: new ObjectId(p.twizzId),
      score: p.score,
      reason: 'Người dùng có sở thích tương tự bạn cũng đã tương tác với bài viết này'
    }))

    recoLog('CF', 'Hoàn tất getRecommendations', { userId, trảVề: out.length, điểmCaoNhất: out[0]?.score })

    return out
  }

  /**
   * Xây dựng hoặc lấy từ cache ma trận User-Item.
   * Giá trị = raw_rating = w_like*like + w_comment*comment + w_quote*quote
   */
  private async getOrBuildUserItemMatrix(): Promise<Map<string, Map<string, number>>> {
    if (this.userItemMatrixCache && this.userItemMatrixCache.expiredAt > Date.now()) {
      recoLog('CF', 'getOrBuildUserItemMatrix: dùng cache', {
        sốUser: this.userItemMatrixCache.matrix.size,
        ttlCòn_ms: this.userItemMatrixCache.expiredAt - Date.now()
      })
      return this.userItemMatrixCache.matrix
    }

    recoLog('CF', 'getOrBuildUserItemMatrix: build mới (likes + comments + quotes)', {})

    const matrix = new Map<string, Map<string, number>>()

    // Thu thập likes
    const likes = await databaseService.likes.find({}, { projection: { user_id: 1, twizz_id: 1 } }).toArray()

    for (const like of likes) {
      const userId = like.user_id.toString()
      const twizzId = like.twizz_id.toString()
      if (!matrix.has(userId)) matrix.set(userId, new Map())
      const userRow = matrix.get(userId)!
      userRow.set(twizzId, (userRow.get(twizzId) ?? 0) + RATING_WEIGHTS.like)
    }

    // Thu thập comments
    const comments = await databaseService.twizzs
      .find({ type: TwizzType.Comment, parent_id: { $ne: null } }, { projection: { user_id: 1, parent_id: 1 } })
      .toArray()

    for (const comment of comments) {
      if (!comment.parent_id) continue
      const userId = comment.user_id.toString()
      const twizzId = comment.parent_id.toString()
      if (!matrix.has(userId)) matrix.set(userId, new Map())
      const userRow = matrix.get(userId)!
      userRow.set(twizzId, (userRow.get(twizzId) ?? 0) + RATING_WEIGHTS.comment)
    }

    // Thu thập quotes
    const quotes = await databaseService.twizzs
      .find({ type: TwizzType.QuoteTwizz, parent_id: { $ne: null } }, { projection: { user_id: 1, parent_id: 1 } })
      .toArray()

    for (const quote of quotes) {
      if (!quote.parent_id) continue
      const userId = quote.user_id.toString()
      const twizzId = quote.parent_id.toString()
      if (!matrix.has(userId)) matrix.set(userId, new Map())
      const userRow = matrix.get(userId)!
      userRow.set(twizzId, (userRow.get(twizzId) ?? 0) + RATING_WEIGHTS.quote)
    }

    this.userItemMatrixCache = { matrix, expiredAt: Date.now() + this.MATRIX_TTL }

    let totalCells = 0
    for (const row of matrix.values()) totalCells += row.size

    recoLog('CF', 'getOrBuildUserItemMatrix: hoàn tất', {
      sốUser: matrix.size,
      tổngÔUserItem: totalCells,
      likes: likes.length,
      comments: comments.length,
      quotes: quotes.length
    })

    return matrix
  }

  /**
   * Tính trung bình rating của một user (dùng cho Mean Offset Normalization).
   */
  private computeMean(userRow: Map<string, number>): number {
    if (userRow.size === 0) return 0
    let sum = 0
    for (const rating of userRow.values()) sum += rating
    return sum / userRow.size
  }

  /**
   * Tìm top K users có sở thích tương tự user hiện tại.
   * Dùng Cosine Similarity trên ma trận đã được Mean Offset Normalization.
   */
  private async findSimilarUsers(
    userId: string,
    matrix: Map<string, Map<string, number>>,
    userMean: number
  ): Promise<Array<{ userId: string; similarity: number; mean: number }>> {
    // Kiểm tra cache
    const cached = this.similarityCache.get(userId)
    if (cached && cached.expiredAt > Date.now()) {
      recoLog('CF', 'findSimilarUsers: dùng cache similarity', {
        userId,
        sốSimilar: cached.similarities.length,
        ttlCòn_ms: cached.expiredAt - Date.now()
      })
      // Lấy mean từ ma trận hiện tại để tính prediction
      return cached.similarities.map((s) => ({
        ...s,
        mean: this.computeMean(matrix.get(s.userId) ?? new Map())
      }))
    }

    const userRow = matrix.get(userId)
    if (!userRow) {
      recoLog('CF', 'findSimilarUsers: không có userRow', { userId })
      return []
    }

    recoLog('CF', 'findSimilarUsers: quét toàn bộ user khác (chưa cache)', {
      userId,
      tổngUserTrongMatrix: matrix.size,
      TOP_K_USERS,
      MIN_COMMON_ITEMS
    })

    // Vector đã normalize (mean offset) của user hiện tại
    const normalizedUserVec = this.meanOffsetNormalize(userRow, userMean)

    const similarities: Array<{ userId: string; similarity: number; mean: number }> = []

    for (const [otherUserId, otherRow] of matrix.entries()) {
      if (otherUserId === userId) continue
      if (otherRow.size === 0) continue

      // Tìm common items (bài viết cả hai đều đã tương tác)
      const commonItems = [...userRow.keys()].filter((twizzId) => otherRow.has(twizzId))
      if (commonItems.length < MIN_COMMON_ITEMS) continue

      const otherMean = this.computeMean(otherRow)
      const normalizedOtherVec = this.meanOffsetNormalize(otherRow, otherMean)

      // Tính Cosine Similarity chỉ trên common items
      const similarity = this.cosineSimilarityOnCommon(normalizedUserVec, normalizedOtherVec, commonItems)

      if (similarity > 0) {
        similarities.push({ userId: otherUserId, similarity, mean: otherMean })
      }
    }

    // Sắp xếp và lấy top K
    similarities.sort((a, b) => b.similarity - a.similarity)
    const topK = similarities.slice(0, TOP_K_USERS)

    // Lưu cache (không lưu mean vì có thể thay đổi)
    this.similarityCache.set(userId, {
      similarities: topK.map((s) => ({ userId: s.userId, similarity: s.similarity })),
      expiredAt: Date.now() + this.SIMILARITY_TTL
    })

    recoLog('CF', 'findSimilarUsers: đã lưu cache topK', { userId, sốTopK: topK.length })

    return topK
  }

  /**
   * Áp dụng Mean Offset Normalization: normalized_rating = raw_rating - user_mean
   */
  private meanOffsetNormalize(userRow: Map<string, number>, mean: number): Map<string, number> {
    const normalized = new Map<string, number>()
    for (const [twizzId, rating] of userRow.entries()) {
      normalized.set(twizzId, rating - mean)
    }
    return normalized
  }

  /**
   * Tính Cosine Similarity chỉ trên các common items.
   */
  private cosineSimilarityOnCommon(
    vecA: Map<string, number>,
    vecB: Map<string, number>,
    commonItems: string[]
  ): number {
    let dotProduct = 0
    let normA = 0
    let normB = 0

    for (const item of commonItems) {
      const a = vecA.get(item) ?? 0
      const b = vecB.get(item) ?? 0
      dotProduct += a * b
      normA += a * a
      normB += b * b
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB)
    if (denominator === 0) return 0
    return dotProduct / denominator
  }

  /**
   * Lấy danh sách twizz_id candidate:
   * Bài mà ít nhất một similar user đã tương tác nhưng user hiện tại chưa.
   */
  private getCandidateTwizzIds(
    similarUsers: Array<{ userId: string; similarity: number; mean: number }>,
    matrix: Map<string, Map<string, number>>,
    interactedTwizzIds: Set<string>
  ): Set<string> {
    const candidates = new Set<string>()
    for (const { userId } of similarUsers) {
      const row = matrix.get(userId)
      if (!row) continue
      for (const twizzId of row.keys()) {
        if (!interactedTwizzIds.has(twizzId)) {
          candidates.add(twizzId)
        }
      }
    }
    return candidates
  }

  /**
   * Dự đoán rating cho user hiện tại với từng bài viết candidate.
   *
   * Công thức:
   * predicted_rating(user, twizz) = user_mean +
   *   Σ(similarity(user, sim_user) × normalized_rating(sim_user, twizz))
   *   / Σ|similarity(user, sim_user)|
   */
  private predictRatings(
    userId: string,
    candidateTwizzIds: Set<string>,
    similarUsers: Array<{ userId: string; similarity: number; mean: number }>,
    matrix: Map<string, Map<string, number>>,
    userMean: number
  ): Array<{ twizzId: string; predictedRating: number }> {
    const predictions: Array<{ twizzId: string; predictedRating: number }> = []

    for (const twizzId of candidateTwizzIds) {
      let weightedSum = 0
      let totalSimilarity = 0

      for (const { userId: simUserId, similarity, mean } of similarUsers) {
        const simUserRow = matrix.get(simUserId)
        const rawRating = simUserRow?.get(twizzId)
        if (rawRating === undefined) continue

        const normalizedRating = rawRating - mean
        weightedSum += similarity * normalizedRating
        totalSimilarity += Math.abs(similarity)
      }

      if (totalSimilarity === 0) continue

      const predictedRating = userMean + weightedSum / totalSimilarity
      predictions.push({ twizzId, predictedRating })
    }

    return predictions
  }

  /**
   * Lọc các bài viết theo quyền truy cập của user.
   * Chỉ giữ bài public (Everyone) và bài trong TwizzCircle của tác giả nếu user thuộc circle đó.
   */
  private async filterByAccessibility(
    userId: string,
    predictions: Array<{ twizzId: string; predictedRating: number }>
  ): Promise<Array<{ twizzId: string; predictedRating: number }>> {
    if (predictions.length === 0) return []

    const twizzIds = predictions.map((p) => new ObjectId(p.twizzId))
    const twizzs = await databaseService.twizzs
      .find(
        { _id: { $in: twizzIds }, type: TwizzType.Twizz }, // Chỉ bài gốc
        { projection: { _id: 1, audience: 1, user_id: 1 } }
      )
      .toArray()

    // Lấy thông tin user để check twizz_circle
    const user = await databaseService.users.findOne({ _id: new ObjectId(userId) }, { projection: { twizz_circle: 1 } })
    const userCircles = new Set((user?.twizz_circle ?? []).map((id: ObjectId) => id.toString()))

    // Tập hợp các twizz_id có thể xem
    const accessibleIds = new Set<string>()
    for (const twizz of twizzs) {
      if (twizz.audience === TwizzAudience.Everyone) {
        accessibleIds.add(twizz._id!.toString())
      } else if (twizz.audience === TwizzAudience.TwizzCircle && userCircles.has(twizz.user_id.toString())) {
        accessibleIds.add(twizz._id!.toString())
      }
    }

    return predictions.filter((p) => accessibleIds.has(p.twizzId))
  }

  /**
   * Chuẩn hóa predicted ratings về khoảng [0, 1] để đồng nhất với Content-Based score.
   */
  private normalizePredictions(
    predictions: Array<{ twizzId: string; predictedRating: number }>
  ): Array<{ twizzId: string; score: number }> {
    if (predictions.length === 0) return []

    const ratings = predictions.map((p) => p.predictedRating)
    const min = Math.min(...ratings)
    const max = Math.max(...ratings)
    const range = max - min

    return predictions.map((p) => ({
      twizzId: p.twizzId,
      score: range === 0 ? 1 : (p.predictedRating - min) / range
    }))
  }

  /**
   * Xóa cache khi có tương tác mới (được gọi từ service khác).
   */
  invalidateMatrixCache(): void {
    recoLog('CF', 'invalidateMatrixCache', {})
    this.userItemMatrixCache = null
  }

  /**
   * Xóa cache similarity của một user cụ thể.
   */
  invalidateUserSimilarityCache(userId: string): void {
    recoLog('CF', 'invalidateUserSimilarityCache', { userId })
    this.similarityCache.delete(userId)
  }
}

const collaborativeFilteringService = new CollaborativeFilteringService()
export default collaborativeFilteringService
