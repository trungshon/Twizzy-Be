import { ObjectId, WithId } from 'mongodb'
import databaseService from './database.services'
import nlpService from './nlp.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import Twizz from '~/models/schemas/Twizz.schema'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả gợi ý từ Content-Based Filtering
export interface ContentBasedResult {
  twizz_id: ObjectId
  score: number // Cosine Similarity (0-1)
  reason: string
}

// Vector TF-IDF: mapping từ -> điểm số
type TFIDFVector = Map<string, number>

// Trọng số tín hiệu tương tác khi xây User Profile
const INTERACTION_WEIGHTS = {
  like: 1.0,
  comment: 1.2,
  quote: 1.5
}

// Trọng số nhân thêm cho hashtag tokens
const HASHTAG_BOOST = 1.5

// Chỉ xét bài viết trong vòng 6 tháng để tính IDF
const CORPUS_MONTHS = 6

class ContentBasedService {
  // Cache User Profile (TTL: 1 giờ)
  private userProfileCache: Map<string, { vector: TFIDFVector; expiredAt: number }>
  // Cache IDF đã tính toán (TTL: 6 giờ)
  private idfCache: { idf: Map<string, number>; expiredAt: number } | null
  // Cache vector của từng bài viết candidate (TTL: 6 giờ)
  private twizzVectorCache: Map<string, { vector: TFIDFVector; expiredAt: number }>

  private readonly USER_PROFILE_TTL = 60 * 60 * 1000 // 1 giờ
  private readonly IDF_TTL = 6 * 60 * 60 * 1000 // 6 giờ
  private readonly TWIZZ_VECTOR_TTL = 6 * 60 * 60 * 1000 // 6 giờ

  constructor() {
    this.userProfileCache = new Map()
    this.idfCache = null
    this.twizzVectorCache = new Map()
  }

  /**
   * Lấy gợi ý bài viết dựa trên Content-Based Filtering.
   * Xây User Profile từ các bài đã like/comment/quote, sau đó tính Cosine Similarity
   * với các bài viết candidate.
   */
  async getRecommendations(userId: string, limit: number): Promise<ContentBasedResult[]> {
    recoLog('ContentBased', 'Bắt đầu getRecommendations', { userId, limit })

    // Lấy danh sách bài đã tương tác (like, comment, quote)
    const interactedTwizzIds = await this.getInteractedTwizzIds(userId)

    recoLog('ContentBased', 'Đã tải map tương tác (distinct twizz)', {
      userId,
      distinctTwizz: interactedTwizzIds.size
    })

    if (interactedTwizzIds.size === 0) {
      recoLog('ContentBased', 'Dừng: chưa có twizz nào được tương tác', { userId })
      return []
    }

    // Xây dựng User Profile vector
    const userProfile = await this.buildUserProfile(userId, interactedTwizzIds)
    if (userProfile.size === 0) {
      recoLog('ContentBased', 'Dừng: user profile rỗng sau NLP/ghi nhận', { userId })
      return []
    }

    recoLog('ContentBased', 'User profile vector', { userId, sốChiều: userProfile.size })

    // Lấy danh sách bài viết candidate (loại trừ đã tương tác và bài của chính user)
    const candidates = await this.getCandidateTwizzs(userId, interactedTwizzIds)
    if (candidates.length === 0) {
      recoLog('ContentBased', 'Dừng: không có candidate sau filter', { userId })
      return []
    }

    recoLog('ContentBased', 'Danh sách candidate', { userId, sốCandidate: candidates.length })

    // Tính IDF từ corpus
    const idf = await this.getOrComputeIDF()

    recoLog('ContentBased', 'IDF sẵn sàng', { userId, sốTerm: idf.size })

    // Tính Cosine Similarity giữa User Profile và từng candidate
    const scored = await this.scoreCandiates(candidates, userProfile, idf)

    // Sắp xếp giảm dần theo điểm số và lấy top N
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, limit)

    recoLog('ContentBased', 'Hoàn tất scoring', {
      userId,
      scoredTrướcCắt: scored.length,
      trảVề: top.length,
      điểmCaoNhất: top[0]?.score
    })

    return top
  }

  /**
   * Lấy tập hợp các twizz_id mà user đã tương tác (like + comment + quote).
   * Trả về Map<twizz_id_string, weighted_count> để tính trọng số khi xây profile.
   */
  async getInteractedTwizzIds(userId: string): Promise<Map<string, number>> {
    const userObjectId = new ObjectId(userId)
    const interactionMap = new Map<string, number>()

    // Lấy danh sách like
    const likes = await databaseService.likes.find({ user_id: userObjectId }, { projection: { twizz_id: 1 } }).toArray()
    for (const like of likes) {
      const key = like.twizz_id.toString()
      interactionMap.set(key, (interactionMap.get(key) ?? 0) + INTERACTION_WEIGHTS.like)
    }

    // Lấy danh sách comment (type = Comment, lấy parent_id)
    const comments = await databaseService.twizzs
      .find(
        { user_id: userObjectId, type: TwizzType.Comment, parent_id: { $ne: null } },
        { projection: { parent_id: 1 } }
      )
      .toArray()
    for (const comment of comments) {
      if (comment.parent_id) {
        const key = comment.parent_id.toString()
        interactionMap.set(key, (interactionMap.get(key) ?? 0) + INTERACTION_WEIGHTS.comment)
      }
    }

    // Lấy danh sách quote (type = QuoteTwizz, lấy parent_id)
    const quotes = await databaseService.twizzs
      .find(
        { user_id: userObjectId, type: TwizzType.QuoteTwizz, parent_id: { $ne: null } },
        { projection: { parent_id: 1 } }
      )
      .toArray()
    for (const quote of quotes) {
      if (quote.parent_id) {
        const key = quote.parent_id.toString()
        interactionMap.set(key, (interactionMap.get(key) ?? 0) + INTERACTION_WEIGHTS.quote)
      }
    }

    recoLog('ContentBased', 'getInteractedTwizzIds', {
      userId,
      likes: likes.length,
      comments: comments.length,
      quotes: quotes.length,
      distinctTwizz: interactionMap.size
    })

    return interactionMap
  }

  /**
   * Xây dựng User Profile vector TF-IDF từ tất cả bài viết đã tương tác.
   * Bài được like/comment/quote nhiều hơn sẽ có đóng góp lớn hơn vào profile.
   */
  private async buildUserProfile(userId: string, interactedTwizzIds: Map<string, number>): Promise<TFIDFVector> {
    // Kiểm tra cache
    const cached = this.userProfileCache.get(userId)
    if (cached && cached.expiredAt > Date.now()) {
      recoLog('ContentBased', 'buildUserProfile: dùng cache', {
        userId,
        ttlCòn_ms: cached.expiredAt - Date.now()
      })
      return cached.vector
    }

    if (interactedTwizzIds.size === 0) {
      recoLog('ContentBased', 'buildUserProfile: không có twizz tương tác', { userId })
      return new Map()
    }

    // Lấy nội dung các bài đã tương tác từ DB
    const twizzIds = Array.from(interactedTwizzIds.keys()).map((id) => new ObjectId(id))
    const twizzs = await databaseService.twizzs
      .find({ _id: { $in: twizzIds } }, { projection: { content: 1, hashtags: 1 } })
      .toArray()

    if (twizzs.length === 0) {
      recoLog('ContentBased', 'buildUserProfile: DB không trả twizz đã tương tác', { userId })
      return new Map()
    }

    // Lấy tên hashtag từ ObjectId
    const allHashtagIds = twizzs.flatMap((t) => t.hashtags)
    const hashtagMap = await this.getHashtagNames(allHashtagIds)

    // Xây dựng văn bản tổng hợp có trọng số
    const texts: string[] = []
    const weights: number[] = []

    for (const twizz of twizzs) {
      const twizzId = twizz._id!.toString()
      const interactionWeight = interactedTwizzIds.get(twizzId) ?? 1.0

      const hashtagNames = twizz.hashtags.map((id) => hashtagMap.get(id.toString()) ?? '').filter(Boolean)

      const text = [twizz.content, ...hashtagNames].join(' ')
      texts.push(text)
      weights.push(interactionWeight)
    }

    // Xử lý NLP cho tất cả bài viết (batch)
    const nlpResults = await nlpService.processBatch(texts)

    // Tổng hợp thành profile vector (tần suất từ có trọng số)
    const termFrequency = new Map<string, number>()

    nlpResults.forEach((nlpResult, idx) => {
      const weight = weights[idx]

      // Thêm các token thông thường
      for (const token of nlpResult.tokens) {
        if (token.length < 2) continue
        const current = termFrequency.get(token) ?? 0
        termFrequency.set(token, current + weight * 1.0)
      }

      // Boost thêm cho hashtag tokens
      for (const hashTag of nlpResult.hashtag_tokens) {
        if (hashTag.length < 2) continue
        const current = termFrequency.get(hashTag) ?? 0
        termFrequency.set(hashTag, current + weight * HASHTAG_BOOST)
      }
    })

    // Chuẩn hóa vector về độ dài 1
    const normalized = this.normalizeVector(termFrequency)

    // Lưu cache
    this.userProfileCache.set(userId, {
      vector: normalized,
      expiredAt: Date.now() + this.USER_PROFILE_TTL
    })

    recoLog('ContentBased', 'buildUserProfile: đã tính + lưu cache', {
      userId,
      sốTwizzGhépProfile: twizzs.length,
      sốChiềuVector: normalized.size
    })

    return normalized
  }

  /**
   * Lấy danh sách bài viết candidate để tính similarity.
   * Loại trừ: bài đã tương tác, bài của chính user, bài không có quyền xem.
   */
  private async getCandidateTwizzs(userId: string, interactedTwizzIds: Map<string, number>): Promise<WithId<Twizz>[]> {
    const userObjectId = new ObjectId(userId)
    const excludeIds = Array.from(interactedTwizzIds.keys()).map((id) => new ObjectId(id))

    // Chỉ xét bài trong 6 tháng gần nhất
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - CORPUS_MONTHS)

    // Lấy thông tin user để check twizz_circle
    const user = await databaseService.users.findOne({ _id: userObjectId }, { projection: { twizz_circle: 1 } })

    const pipeline = [
      {
        $match: {
          _id: { $nin: excludeIds },
          user_id: { $ne: userObjectId },
          type: { $in: [TwizzType.Twizz, TwizzType.QuoteTwizz] },
          created_at: { $gte: sixMonthsAgo }
        }
      },
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
      { $limit: 500 }
    ]

    const candidates = await databaseService.twizzs.aggregate(pipeline).toArray()
    return candidates as any[]
  }

  /**
   * Tính hoặc lấy từ cache ma trận IDF từ corpus bài viết.
   * IDF(term) = log(N / df(term)) với N là tổng số bài, df là số bài chứa term.
   */
  private async getOrComputeIDF(): Promise<Map<string, number>> {
    if (this.idfCache && this.idfCache.expiredAt > Date.now()) {
      recoLog('ContentBased', 'getOrComputeIDF: dùng cache', {
        sốTerm: this.idfCache.idf.size,
        ttlCòn_ms: this.idfCache.expiredAt - Date.now()
      })
      return this.idfCache.idf
    }

    recoLog('ContentBased', 'getOrComputeIDF: tính mới từ corpus', {})

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - CORPUS_MONTHS)

    // Lấy sample corpus (tối đa 1000 bài) để tính IDF
    const corpusTwizzs = await databaseService.twizzs
      .find({ type: TwizzType.Twizz, created_at: { $gte: sixMonthsAgo } }, { projection: { content: 1, hashtags: 1 } })
      .limit(1000)
      .toArray()

    const totalDocs = corpusTwizzs.length
    if (totalDocs === 0) {
      recoLog('ContentBased', 'getOrComputeIDF: corpus rỗng', {})
      return new Map()
    }

    // Lấy tên hashtag
    const allHashtagIds = corpusTwizzs.flatMap((t) => t.hashtags)
    const hashtagMap = await this.getHashtagNames(allHashtagIds)

    // Xử lý NLP batch
    const texts = corpusTwizzs.map((t) => {
      const hashtagNames = t.hashtags.map((id) => hashtagMap.get(id.toString()) ?? '').filter(Boolean)
      return [t.content, ...hashtagNames].join(' ')
    })

    const nlpResults = await nlpService.processBatch(texts)

    // Đếm document frequency cho mỗi term
    const documentFrequency = new Map<string, number>()
    for (const result of nlpResults) {
      const termsInDoc = new Set([...result.tokens, ...result.hashtag_tokens])
      for (const term of termsInDoc) {
        if (term.length < 2) continue
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
      }
    }

    // Tính IDF
    const idf = new Map<string, number>()
    for (const [term, df] of documentFrequency.entries()) {
      idf.set(term, Math.log((totalDocs + 1) / (df + 1)) + 1) // Smooth IDF
    }

    // Lưu cache
    this.idfCache = { idf, expiredAt: Date.now() + this.IDF_TTL }

    recoLog('ContentBased', 'getOrComputeIDF: hoàn tất', {
      corpusDocs: totalDocs,
      sốTerm: idf.size
    })

    return idf
  }

  /**
   * Tính điểm Cosine Similarity giữa User Profile và từng bài viết candidate.
   */
  private async scoreCandiates(
    candidates: WithId<Twizz>[],
    userProfile: TFIDFVector,
    idf: Map<string, number>
  ): Promise<ContentBasedResult[]> {
    const results: ContentBasedResult[] = []

    recoLog('ContentBased', 'scoreCandiates: bắt đầu', {
      sốCandidate: candidates.length
    })

    // Lấy tên hashtag cho tất cả candidate
    const allHashtagIds = candidates.flatMap((t) => t.hashtags)
    const hashtagMap = await this.getHashtagNames(allHashtagIds)

    // Lấy vector từ cache hoặc tính mới (batch)
    const textsToProcess: { idx: number; text: string }[] = []
    const cachedVectors: Map<number, TFIDFVector> = new Map()

    candidates.forEach((twizz, idx) => {
      const cacheKey = twizz._id!.toString()
      const cached = this.twizzVectorCache.get(cacheKey)
      if (cached && cached.expiredAt > Date.now()) {
        cachedVectors.set(idx, cached.vector)
      } else {
        const hashtagNames = twizz.hashtags.map((id) => hashtagMap.get(id.toString()) ?? '').filter(Boolean)
        const text = [twizz.content, ...hashtagNames].join(' ')
        textsToProcess.push({ idx, text })
      }
    })

    // Xử lý NLP batch cho những bài chưa cache
    if (textsToProcess.length > 0) {
      recoLog('ContentBased', 'scoreCandiates: cần NLP cho bài chưa cache vector', {
        đãCacheVector: cachedVectors.size,
        cầnXửLý: textsToProcess.length
      })
      const nlpResults = await nlpService.processBatch(textsToProcess.map((t) => t.text))

      nlpResults.forEach((nlpResult, i) => {
        const { idx } = textsToProcess[i]
        const twizz = candidates[idx]

        // Tính TF-IDF vector cho bài viết
        const termFreq = new Map<string, number>()
        const totalTerms = nlpResult.tokens.length + nlpResult.hashtag_tokens.length * HASHTAG_BOOST

        for (const token of nlpResult.tokens) {
          if (token.length < 2) continue
          const tf = 1 / (totalTerms || 1)
          const idfScore = idf.get(token) ?? 0
          termFreq.set(token, tf * idfScore)
        }

        for (const hashTag of nlpResult.hashtag_tokens) {
          if (hashTag.length < 2) continue
          const tf = HASHTAG_BOOST / (totalTerms || 1)
          const idfScore = idf.get(hashTag) ?? 0
          const current = termFreq.get(hashTag) ?? 0
          termFreq.set(hashTag, current + tf * idfScore)
        }

        const normalizedVector = this.normalizeVector(termFreq)

        // Lưu cache
        const cacheKey = twizz._id!.toString()
        this.twizzVectorCache.set(cacheKey, {
          vector: normalizedVector,
          expiredAt: Date.now() + this.TWIZZ_VECTOR_TTL
        })

        cachedVectors.set(idx, normalizedVector)
      })
    } else {
      recoLog('ContentBased', 'scoreCandiates: toàn bộ vector candidate đã có cache', {
        sốCandidate: candidates.length
      })
    }

    // Tính Cosine Similarity
    for (let i = 0; i < candidates.length; i++) {
      const twizz = candidates[i]
      const twizzVector = cachedVectors.get(i)
      if (!twizzVector) continue

      const similarity = this.cosineSimilarity(userProfile, twizzVector)
      if (similarity > 0.01) {
        results.push({
          twizz_id: twizz._id!,
          score: similarity,
          reason: 'Dựa trên nội dung bài viết bạn đã tương tác'
        })
      }
    }

    recoLog('ContentBased', 'scoreCandiates: hoàn tất cosine', {
      sốKếtQuảTrênNgưỡng: results.length
    })

    return results
  }

  /**
   * Tính Cosine Similarity giữa hai TF-IDF vectors.
   * Cosine Similarity = (A · B) / (||A|| × ||B||)
   * Do các vector đã được chuẩn hóa về độ dài 1, chỉ cần tính dot product.
   */
  private cosineSimilarity(vecA: TFIDFVector, vecB: TFIDFVector): number {
    let dotProduct = 0
    for (const [term, scoreA] of vecA.entries()) {
      const scoreB = vecB.get(term)
      if (scoreB !== undefined) {
        dotProduct += scoreA * scoreB
      }
    }
    return dotProduct // Đã chuẩn hóa nên không cần chia thêm
  }

  /**
   * Chuẩn hóa vector về độ dài 1 (L2 normalization).
   */
  private normalizeVector(vector: TFIDFVector): TFIDFVector {
    let norm = 0
    for (const value of vector.values()) {
      norm += value * value
    }
    norm = Math.sqrt(norm)
    if (norm === 0) return vector

    const normalized = new Map<string, number>()
    for (const [key, value] of vector.entries()) {
      normalized.set(key, value / norm)
    }
    return normalized
  }

  /**
   * Lấy tên hashtag từ danh sách ObjectId.
   * Trả về Map<id_string, name> để tra cứu nhanh.
   */
  private async getHashtagNames(hashtagIds: ObjectId[]): Promise<Map<string, string>> {
    if (hashtagIds.length === 0) return new Map()

    const uniqueIds = [...new Set(hashtagIds.map((id) => id.toString()))].map((id) => new ObjectId(id))
    const hashtags = await databaseService.hashtags
      .find({ _id: { $in: uniqueIds } }, { projection: { name: 1 } })
      .toArray()

    const map = new Map<string, string>()
    for (const hashtag of hashtags) {
      map.set(hashtag._id!.toString(), hashtag.name)
    }
    return map
  }

  /**
   * Xóa cache User Profile khi user có tương tác mới.
   * Gọi từ likes/comments/quotes service sau khi có tương tác mới.
   */
  invalidateUserCache(userId: string): void {
    recoLog('ContentBased', 'invalidateUserCache (profile)', { userId })
    this.userProfileCache.delete(userId)
  }
}

const contentBasedService = new ContentBasedService()
export default contentBasedService
