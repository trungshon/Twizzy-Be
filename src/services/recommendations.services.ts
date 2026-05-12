import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import contentBasedService from './contentBased.services'
import collaborativeFilteringService from './collaborativeFiltering.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả gợi ý trung gian (chỉ lưu ID + điểm số, chưa populate)
interface ScoredItem {
  twizz_id: ObjectId
  score: number
  reason: string
  algorithm: 'content' | 'collaborative' | 'hybrid' | 'trending' | 'following'
}

// Metadata về kết quả gợi ý
interface RecommendationMeta {
  total_recommended: number
  content_based_count: number
  collaborative_count: number
  trending_count: number
  following_count: number
  processing_time_ms: number
}

// Kết quả nội bộ (trước khi populate và phân trang)
interface InternalResult {
  items: ScoredItem[]
  meta: RecommendationMeta
}

// Kết quả trả về cho client (đã populate + phân trang)
export interface PaginatedRecommendations {
  twizzs: any[]
  limit: number
  page: number
  total_page: number
  metadata: RecommendationMeta
}

// Ngưỡng tương tác hiệu dụng để bật Hybrid
const EFFECTIVE_INTERACTION_THRESHOLD = 15
// Số bài khác nhau tối thiểu đã tương tác
const MIN_DISTINCT_TWIZZ = 8

// Trọng số tính effective_interactions (nhất quán với contentBased.services.ts)
const EFFECTIVE_WEIGHTS = { like: 1.0, comment: 1.2, quote: 1.5 }

// Trọng số Hybrid (Content-Based : Collaborative = 60 : 40)
const HYBRID_WEIGHTS = { content: 0.6, collaborative: 0.4 }

// Trọng số khi không tìm được users tương tự
const FALLBACK_WEIGHTS = { content: 0.8, trending: 0.2 }

// Trọng số Cold Start khi có follow
const COLD_START_FOLLOW_WEIGHTS = { following: 0.7, trending: 0.3 }

// Trọng số tính trending score
const TRENDING_WEIGHTS = { like: 1.0, comment: 0.8, quote: 1.2 }

// Số ngày lookback khi tính trending
const TRENDING_DAYS = 7

// Số bài tối đa trong pool gợi ý (để phân trang)
const RECOMMENDATION_POOL_SIZE = 60

import { ContentBasedResult } from './contentBased.services'
import { CollaborativeResult } from './collaborativeFiltering.services'

class RecommendationService {
  // Cache danh sách scored IDs cho mỗi user (TTL: 30 phút)
  private scoredCache: Map<string, { items: ScoredItem[]; meta: RecommendationMeta; expiredAt: number }>
  private readonly SCORED_TTL = 30 * 60 * 1000

  constructor() {
    this.scoredCache = new Map()
  }

  /**
   * Điểm vào chính: lấy gợi ý Hybrid cho user, có hỗ trợ phân trang.
   *
   * Luồng:
   * - Trang 1..N (trong pool hiện tại): lấy từ cache, populate và trả về.
   * - Pool cạn kiệt (page > total_page): xóa cache, tính lại pool mới,
   *   trả về page 1 của pool mới — Flutter phát hiện và tiếp tục append.
   */
  async getHybridRecommendations(userId: string, limit: number, page: number): Promise<PaginatedRecommendations> {
    const startTime = Date.now()

    recoLog('Orchestrator', 'Bắt đầu getHybridRecommendations', {
      userId,
      limit,
      page,
      poolSizeTốiĐa: RECOMMENDATION_POOL_SIZE
    })

    // Kiểm tra cache (key = userId, không phụ thuộc limit/page)
    const cached = this.scoredCache.get(userId)
    if (cached && cached.expiredAt > Date.now()) {
      const totalPage = Math.max(1, Math.ceil(cached.items.length / limit))

      if (page <= totalPage) {
        // Pool chưa hết → phục vụ từ cache
        recoLog('Orchestrator', 'Dùng pool đã cache (trang nằm trong pool)', {
          userId,
          page,
          totalPage,
          sốBàiTrongPool: cached.items.length,
          ttlCòn_ms: cached.expiredAt - Date.now()
        })
        return this.paginateAndPopulate(cached.items, cached.meta, userId, limit, page, startTime)
      }

      // Pool cạn kiệt → xóa cache để tính lại
      recoLog('Orchestrator', 'Pool hết trang → xóa cache, sẽ tính lại pool mới', {
        userId,
        pageYêuCầu: page,
        totalPageTrướcĐó: totalPage,
        limit
      })
      this.scoredCache.delete(userId)
    } else if (cached) {
      recoLog('Orchestrator', 'Cache pool hết hạn TTL', { userId })
      this.scoredCache.delete(userId)
    }

    // Tính chỉ số tương tác để chọn chiến lược
    const { effectiveCount, distinctTwizzCount } = await this.computeEffectiveInteractions(userId)

    recoLog('Orchestrator', 'Chỉ số cold start / hybrid', {
      effectiveCount,
      distinctTwizzCount,
      ngưỡngEffective: EFFECTIVE_INTERACTION_THRESHOLD,
      ngưỡngDistinctTwizz: MIN_DISTINCT_TWIZZ
    })

    let internalResult: InternalResult

    if (effectiveCount === 0) {
      // Trường hợp 1: Chưa có tương tác nào -> Cold Start
      recoLog('Orchestrator', 'Chiến lược: Cold Start (chưa có tương tác)', { userId })
      internalResult = await this.coldStartRecommendations(userId, RECOMMENDATION_POOL_SIZE, startTime)
    } else if (effectiveCount < EFFECTIVE_INTERACTION_THRESHOLD || distinctTwizzCount < MIN_DISTINCT_TWIZZ) {
      // Trường hợp 2: Ít tương tác -> Content-Based only
      recoLog('Orchestrator', 'Chiến lược: Content-Based only (+ trending nếu thiếu)', {
        userId,
        lýDo: effectiveCount < EFFECTIVE_INTERACTION_THRESHOLD ? 'effective < ngưỡng' : 'distinct_twizz < ngưỡng'
      })
      internalResult = await this.contentBasedOnlyRecommendations(userId, RECOMMENDATION_POOL_SIZE, startTime)
    } else {
      // Trường hợp 3: Đủ tương tác -> Hybrid
      recoLog('Orchestrator', 'Chiến lược: Hybrid (Content + Collaborative)', { userId })
      internalResult = await this.hybridRecommendations(userId, RECOMMENDATION_POOL_SIZE, limit, startTime)
    }

    // Lưu cache scored items của pool mới
    this.scoredCache.set(userId, {
      items: internalResult.items,
      meta: internalResult.meta,
      expiredAt: Date.now() + this.SCORED_TTL
    })

    recoLog('Orchestrator', 'Đã lưu pool mới vào cache', {
      userId,
      sốBàiTrongPool: internalResult.items.length,
      meta: internalResult.meta,
      ttl_ms: this.SCORED_TTL
    })

    // Luôn trả về page 1 của pool mới (Flutter phát hiện qua response.page)
    recoLog('Orchestrator', 'Trả về trang 1 của pool mới (sau khi tính lại)', { userId, limit })
    return this.paginateAndPopulate(internalResult.items, internalResult.meta, userId, limit, 1, startTime)
  }

  /**
   * Phân trang từ scored items và populate dữ liệu đầy đủ từ MongoDB.
   */
  private async paginateAndPopulate(
    items: ScoredItem[],
    meta: RecommendationMeta,
    userId: string,
    limit: number,
    page: number,
    startTime: number
  ): Promise<PaginatedRecommendations> {
    const total = items.length
    const total_page = Math.max(1, Math.ceil(total / limit))
    const pageItems = items.slice((page - 1) * limit, page * limit)
    const twizzs = await this.populateTwizzsByIds(pageItems, userId)

    recoLog('Orchestrator', 'Populate xong', {
      userId,
      page,
      sốTwizzTrảVề: twizzs.length,
      processing_ms_trongMeta: meta.processing_time_ms
    })

    return {
      twizzs,
      limit,
      page,
      total_page,
      metadata: {
        ...meta,
        processing_time_ms: Date.now() - startTime
      }
    }
  }

  /**
   * Populate dữ liệu đầy đủ cho danh sách twizz_id.
   * Kết quả giữ nguyên thứ tự theo score (thứ tự của twizzIds đầu vào).
   */
  private async populateTwizzsByIds(scoredItems: ScoredItem[], userId: string): Promise<any[]> {
    if (scoredItems.length === 0) {
      recoLog('Orchestrator', 'populateTwizzsByIds: danh sách rỗng, bỏ qua aggregation', { userId })
      return []
    }

    const twizzIds = scoredItems.map((i) => i.twizz_id)

    recoLog('Orchestrator', 'populateTwizzsByIds: chạy aggregation join user/hashtag/likes...', {
      userId,
      sốId: twizzIds.length
    })

    const user_id_objectId = new ObjectId(userId)

    const results = await databaseService.twizzs
      .aggregate([
        // Lọc theo danh sách ID đề xuất
        { $match: { _id: { $in: twizzIds } } },
        // Join user (author)
        {
          $lookup: {
            from: 'users',
            localField: 'user_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: { path: '$user' } },
        // Join hashtags
        {
          $lookup: {
            from: 'hashtags',
            localField: 'hashtags',
            foreignField: '_id',
            as: 'hashtags'
          }
        },
        // Join mentions
        {
          $lookup: {
            from: 'users',
            localField: 'mentions',
            foreignField: '_id',
            as: 'mentions'
          }
        },
        {
          $addFields: {
            mentions: {
              $map: {
                input: '$mentions',
                as: 'mention',
                in: {
                  _id: '$$mention._id',
                  name: '$$mention.name',
                  username: '$$mention.username',
                  email: '$$mention.email'
                }
              }
            }
          }
        },
        // Join bookmarks count
        {
          $lookup: {
            from: 'bookmarks',
            localField: '_id',
            foreignField: 'twizz_id',
            as: 'bookmarks'
          }
        },
        // Join likes count
        {
          $lookup: {
            from: 'likes',
            localField: '_id',
            foreignField: 'twizz_id',
            as: 'likes'
          }
        },
        // Join children (để đếm comment/quote)
        {
          $lookup: {
            from: 'twizzs',
            localField: '_id',
            foreignField: 'parent_id',
            as: 'twizz_children'
          }
        },
        // Join parent twizz (cho quote/comment)
        {
          $lookup: {
            from: 'twizzs',
            localField: 'parent_id',
            foreignField: '_id',
            as: 'parent_twizz',
            pipeline: [
              {
                $lookup: {
                  from: 'users',
                  localField: 'user_id',
                  foreignField: '_id',
                  as: 'user'
                }
              },
              { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
              {
                $lookup: {
                  from: 'twizzs',
                  localField: 'parent_id',
                  foreignField: '_id',
                  pipeline: [
                    {
                      $lookup: {
                        from: 'users',
                        localField: 'user_id',
                        foreignField: '_id',
                        as: 'user'
                      }
                    },
                    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                    {
                      $project: {
                        user: {
                          password: 0,
                          email_verify_token: 0,
                          email_verify_otp: 0,
                          email_verify_otp_expires_at: 0,
                          forgot_password_otp: 0,
                          forgot_password_otp_expires_at: 0,
                          forgot_password_token: 0,
                          date_of_birth: 0,
                          interest_vector: 0
                        },
                        content_vector: 0
                      }
                    }
                  ],
                  as: 'parent_twizz'
                }
              },
              { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
              {
                $lookup: {
                  from: 'hashtags',
                  localField: 'hashtags',
                  foreignField: '_id',
                  as: 'hashtags'
                }
              },
              {
                $lookup: {
                  from: 'bookmarks',
                  localField: '_id',
                  foreignField: 'twizz_id',
                  as: 'bookmarks'
                }
              },
              {
                $lookup: {
                  from: 'likes',
                  localField: '_id',
                  foreignField: 'twizz_id',
                  as: 'likes'
                }
              },
              {
                $lookup: {
                  from: 'twizzs',
                  localField: '_id',
                  foreignField: 'parent_id',
                  as: 'twizz_children'
                }
              },
              {
                $lookup: {
                  from: 'likes',
                  localField: '_id',
                  foreignField: 'twizz_id',
                  as: 'user_likes',
                  pipeline: [{ $match: { user_id: user_id_objectId } }]
                }
              },
              {
                $lookup: {
                  from: 'bookmarks',
                  localField: '_id',
                  foreignField: 'twizz_id',
                  as: 'user_bookmarks',
                  pipeline: [{ $match: { user_id: user_id_objectId } }]
                }
              },
              {
                $addFields: {
                  bookmarks: { $size: '$bookmarks' },
                  likes: { $size: '$likes' },
                  is_liked: { $gt: [{ $size: '$user_likes' }, 0] },
                  is_bookmarked: { $gt: [{ $size: '$user_bookmarks' }, 0] },
                  comment_count: {
                    $size: {
                      $filter: {
                        input: '$twizz_children',
                        as: 'item',
                        cond: { $eq: ['$$item.type', TwizzType.Comment] }
                      }
                    }
                  },
                  quote_count: {
                    $size: {
                      $filter: {
                        input: '$twizz_children',
                        as: 'item',
                        cond: { $eq: ['$$item.type', TwizzType.QuoteTwizz] }
                      }
                    }
                  }
                }
              },
              {
                $project: {
                  twizz_children: 0,
                  user_likes: 0,
                  user_bookmarks: 0,
                  user: {
                    password: 0,
                    email_verify_token: 0,
                    email_verify_otp: 0,
                    email_verify_otp_expires_at: 0,
                    forgot_password_token: 0,
                    forgot_password_otp: 0,
                    forgot_password_otp_expires_at: 0,
                    date_of_birth: 0,
                    interest_vector: 0
                  },
                  content_vector: 0
                }
              }
            ]
          }
        },
        { $addFields: { parent_twizz: { $arrayElemAt: ['$parent_twizz', 0] } } },
        // user_likes / user_bookmarks để tính is_liked, is_bookmarked
        {
          $lookup: {
            from: 'likes',
            localField: '_id',
            foreignField: 'twizz_id',
            as: 'user_likes',
            pipeline: [{ $match: { user_id: user_id_objectId } }]
          }
        },
        {
          $lookup: {
            from: 'bookmarks',
            localField: '_id',
            foreignField: 'twizz_id',
            as: 'user_bookmarks',
            pipeline: [{ $match: { user_id: user_id_objectId } }]
          }
        },
        {
          $addFields: {
            bookmarks: { $size: '$bookmarks' },
            likes: { $size: '$likes' },
            is_liked: { $gt: [{ $size: '$user_likes' }, 0] },
            is_bookmarked: { $gt: [{ $size: '$user_bookmarks' }, 0] },
            comment_count: {
              $size: {
                $filter: {
                  input: '$twizz_children',
                  as: 'item',
                  cond: { $eq: ['$$item.type', TwizzType.Comment] }
                }
              }
            },
            quote_count: {
              $size: {
                $filter: {
                  input: '$twizz_children',
                  as: 'item',
                  cond: { $eq: ['$$item.type', TwizzType.QuoteTwizz] }
                }
              }
            }
          }
        },
        {
          $project: {
            twizz_children: 0,
            user_likes: 0,
            user_bookmarks: 0,
            user: {
              password: 0,
              email_verify_token: 0,
              email_verify_otp: 0,
              email_verify_otp_expires_at: 0,
              forgot_password_token: 0,
              forgot_password_otp: 0,
              forgot_password_otp_expires_at: 0,
              date_of_birth: 0,
              interest_vector: 0
            },
            content_vector: 0
          }
        }
      ])
      .toArray()

    // Tăng user_views
    const date = new Date()
    await databaseService.twizzs.updateMany(
      { _id: { $in: twizzIds } },
      { $inc: { user_views: 1 }, $set: { updated_at: date } }
    )

    // Giữ đúng thứ tự và gắn metadata gợi ý
    const map = new Map(results.map((t: any) => [t._id.toString(), t]))
    return scoredItems
      .map((item) => {
        const doc = map.get(item.twizz_id.toString())
        if (doc) {
          doc.updated_at = date
          doc.user_views = (doc.user_views ?? 0) + 1
          // Gắn thông tin nguồn gợi ý
          doc.recommendation_info = {
            algorithm: item.algorithm,
            reason: item.reason,
            score: item.score
          }
        }
        return doc
      })
      .filter(Boolean)
  }

  /**
   * Tính số tương tác hiệu dụng và số bài khác nhau đã tương tác.
   */
  private async computeEffectiveInteractions(
    userId: string
  ): Promise<{ effectiveCount: number; distinctTwizzCount: number }> {
    const interactedMap = await contentBasedService.getInteractedTwizzIds(userId)

    let effectiveCount = 0
    for (const weight of interactedMap.values()) {
      effectiveCount += weight
    }

    const distinctTwizzCount = interactedMap.size

    recoLog('Orchestrator', 'computeEffectiveInteractions', {
      userId,
      effectiveCount,
      distinctTwizzCount
    })

    return { effectiveCount, distinctTwizzCount }
  }

  /**
   * Cold Start: user chưa có tương tác nào.
   */
  private async coldStartRecommendations(userId: string, limit: number, startTime: number): Promise<InternalResult> {
    const followingCount = await databaseService.followers.countDocuments({
      user_id: new ObjectId(userId)
    })

    recoLog('Orchestrator', 'coldStartRecommendations: số người đang follow', { userId, followingCount, limit })

    let followingItems: ScoredItem[] = []
    let trendingItems: ScoredItem[] = []

    if (followingCount > 0) {
      const followingLimit = Math.ceil(limit * COLD_START_FOLLOW_WEIGHTS.following)
      const trendingLimit = limit - followingLimit

      recoLog('Orchestrator', 'Cold Start: user có follow → following + trending', {
        userId,
        followingCount,
        followingLimit,
        trendingLimit
      })

      followingItems = await this.getFollowingTwizzs(userId, followingLimit)
      trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, new Set())
    } else {
      recoLog('Orchestrator', 'Cold Start: user không follow ai → chỉ trending', { userId, limit })
      trendingItems = await this.getTrendingTwizzs(userId, limit, new Set())
    }

    const combined = [...followingItems, ...trendingItems]
    const deduplicated = this.deduplicateAndDiversify(combined, limit)

    recoLog('Orchestrator', 'Cold Start: sau dedupe', {
      userId,
      following_raw: followingItems.length,
      trending_raw: trendingItems.length,
      sauDedupe: deduplicated.length
    })

    return this.buildInternalResult(
      deduplicated,
      { trending: trendingItems.length, following: followingItems.length },
      startTime
    )
  }

  /**
   * Content-Based only: user có ít tương tác.
   */
  private async contentBasedOnlyRecommendations(
    userId: string,
    limit: number,
    startTime: number
  ): Promise<InternalResult> {
    recoLog('Orchestrator', 'Content-only: gọi Content-Based', { userId, limit })
    const contentResults = await contentBasedService.getRecommendations(userId, limit)

    const contentItems: ScoredItem[] = contentResults.map((r) => ({
      twizz_id: r.twizz_id,
      score: r.score,
      reason: r.reason,
      algorithm: 'content' as const
    }))

    let trendingItems: ScoredItem[] = []

    if (contentItems.length < limit) {
      const remaining = limit - contentItems.length
      const excludeIds = new Set(contentItems.map((t) => t.twizz_id.toString()))
      recoLog('Orchestrator', 'Content-only: thiếu bài → bổ sung trending', {
        userId,
        contentCount: contentItems.length,
        remaining
      })
      trendingItems = await this.getTrendingTwizzs(userId, remaining, excludeIds)
    }

    const combined = [...contentItems, ...trendingItems]
    const deduplicated = this.deduplicateAndDiversify(combined, limit)

    recoLog('Orchestrator', 'Content-only: sau dedupe', {
      userId,
      content_raw: contentItems.length,
      trending_raw: trendingItems.length,
      sauDedupe: deduplicated.length
    })

    return this.buildInternalResult(
      deduplicated,
      { content: contentItems.length, trending: trendingItems.length },
      startTime
    )
  }

  /**
   * Hybrid: kết hợp Content-Based (70%) và Collaborative (30%).
   */
  private async hybridRecommendations(userId: string, poolSize: number, pageLimit: number, startTime: number): Promise<InternalResult> {
    // Giới hạn Content-Based để "nhường chỗ" cho CF
    // Nếu pool = 60 bài → Content lấy tối đa 40, CF lấy tối đa 60
    const contentLimit = Math.ceil(poolSize * 0.65)
    const collabLimit = poolSize

    recoLog('Orchestrator', 'Hybrid: song song Content-Based + CF', {
      userId,
      poolSize,
      pageLimit,
      contentLimit,
      collabLimit
    })
    const [contentResults, collaborativeResults] = await Promise.all([
      contentBasedService.getRecommendations(userId, contentLimit),
      collaborativeFilteringService.getRecommendations(userId, collabLimit)
    ])

    recoLog('Orchestrator', 'Hybrid: kết quả thô từ 2 nhánh', {
      userId,
      contentCount: contentResults.length,
      collaborativeCount: collaborativeResults.length
    })

    let contentCount = 0
    let collaborativeCount = 0

    // Fallback khi không tìm được similar users
    if (collaborativeResults.length === 0) {
      recoLog('Orchestrator', 'Hybrid: CF rỗng → fallback content + trending', { userId })
      const contentItems: ScoredItem[] = contentResults.map((r) => ({
        twizz_id: r.twizz_id,
        score: r.score * FALLBACK_WEIGHTS.content,
        reason: r.reason,
        algorithm: 'content' as const
      }))

      const excludeIds = new Set(contentItems.map((t) => t.twizz_id.toString()))
      const trendingLimit = Math.ceil(poolSize * FALLBACK_WEIGHTS.trending)
      const trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, excludeIds)

      const combined = [...contentItems, ...trendingItems]
      const deduplicated = this.deduplicateAndDiversify(combined, poolSize)

      recoLog('Orchestrator', 'Hybrid fallback: sau dedupe', {
        userId,
        sauDedupe: deduplicated.length
      })

      return this.buildInternalResult(
        deduplicated,
        { content: contentItems.length, trending: trendingItems.length },
        startTime
      )
    }

    // Thực hiện xen kẽ 65% Content : 35% Collaborative trên từng trang
    // pageLimit = kích thước trang thực tế (20), không phải poolSize (60)
    const hybridDeduplicated = this.interleaveHybridResults(contentResults, collaborativeResults, pageLimit)

    // Đếm lại số lượng từ mỗi nguồn sau khi đã xen kẽ và lọc trùng
    contentCount = 0
    collaborativeCount = 0
    hybridDeduplicated.forEach((item) => {
      if (item.algorithm === 'content' || item.algorithm === 'hybrid') contentCount++
      if (item.algorithm === 'collaborative' || item.algorithm === 'hybrid') collaborativeCount++
    })

    recoLog('Orchestrator', 'Hybrid: sau xen kẽ (Slot-based 65:35)', {
      userId,
      sauDedupe: hybridDeduplicated.length,
      contentCount,
      collaborativeCount
    })

    return this.buildInternalResult(
      hybridDeduplicated,
      { content: contentCount, collaborative: collaborativeCount },
      startTime
    )
  }

  /**
   * Xen kẽ kết quả theo tỉ lệ 65% Content : 35% Collab trên từng trang (Slot-filling)
   * @param pageLimit Kích thước trang thực tế (VD: 20), dùng để tính số slot Content/Collab mỗi trang
   */
  private interleaveHybridResults(
    contentItems: ContentBasedResult[],
    collabItems: CollaborativeResult[],
    pageLimit: number
  ): ScoredItem[] {
    const finalPool: ScoredItem[] = []
    const MAX_POOL = 60

    // Tỉ lệ mỗi trang thực tế (pageLimit=20 -> 13 Content, 7 Collab)
    const contentPerPage = Math.ceil(pageLimit * 0.65)
    const collabPerPage = pageLimit - contentPerPage

    // Lọc trùng: Nếu bài xuất hiện ở cả 2, ta coi nó là 'hybrid' và ưu tiên đưa vào hàng đợi Content
    // SỬ DỤNG SCORE GỐC từ Vector Search (Cosine Similarity) và CF (Predicted Rating)
    const contentQueue: ScoredItem[] = contentItems.map((item) => {
      const collabMatch = collabItems.find((c) => c.twizz_id.toString() === item.twizz_id.toString())
      // Score gốc × trọng số Hybrid, cộng thêm CF score nếu trùng
      const contentScore = item.score * HYBRID_WEIGHTS.content
      const collabScore = collabMatch ? collabMatch.score * HYBRID_WEIGHTS.collaborative : 0

      return {
        twizz_id: item.twizz_id,
        score: contentScore + collabScore,
        algorithm: collabMatch ? ('hybrid' as const) : ('content' as const),
        reason: collabMatch ? 'Phù hợp sở thích và được nhiều người cùng gu yêu thích' : item.reason
      }
    })

    const collabQueue: ScoredItem[] = collabItems
      .filter((ci) => !contentItems.find((ui) => ui.twizz_id.toString() === ci.twizz_id.toString()))
      .map((item) => ({
        twizz_id: item.twizz_id,
        score: item.score * HYBRID_WEIGHTS.collaborative,
        algorithm: 'collaborative' as const,
        reason: 'Được những người có sở thích tương đồng với bạn yêu thích'
      }))

    let cIdx = 0
    let colIdx = 0

    // Điền vào pool theo từng "trang" ảo
    while (finalPool.length < MAX_POOL && (cIdx < contentQueue.length || colIdx < collabQueue.length)) {
      // 1. Fill Content slots cho trang hiện tại
      for (let i = 0; i < contentPerPage && finalPool.length < MAX_POOL; i++) {
        if (cIdx < contentQueue.length) finalPool.push(contentQueue[cIdx++])
      }
      // 2. Fill Collab slots cho trang hiện tại
      for (let i = 0; i < collabPerPage && finalPool.length < MAX_POOL; i++) {
        if (colIdx < collabQueue.length) {
          finalPool.push(collabQueue[colIdx++])
        } else if (cIdx < contentQueue.length) {
          // Nếu hết bài Collab, lấy thêm bài Content để lấp chỗ trống
          finalPool.push(contentQueue[cIdx++])
        }
      }
    }

    return finalPool
  }

  /**
   * Lấy bài viết từ những người user đang follow.
   */
  private async getFollowingTwizzs(userId: string, limit: number): Promise<ScoredItem[]> {
    const following = await databaseService.followers
      .find({ user_id: new ObjectId(userId) }, { projection: { followed_user_id: 1 } })
      .toArray()

    if (following.length === 0) {
      recoLog('Orchestrator', 'getFollowingTwizzs: không có follow', { userId })
      return []
    }

    const followedIds = following.map((f) => f.followed_user_id)
    const userObjectId = new ObjectId(userId)

    const pipeline = [
      {
        $match: {
          user_id: { $in: followedIds },
          type: { $in: [TwizzType.Twizz, TwizzType.QuoteTwizz] }
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
      { $sort: { created_at: -1 as const } },
      { $limit: limit },
      { $project: { _id: 1 } }
    ]

    const twizzs = await databaseService.twizzs.aggregate(pipeline).toArray()

    recoLog('Orchestrator', 'getFollowingTwizzs', {
      userId,
      sốNgườiFollow: followedIds.length,
      sốBàiLấyĐược: twizzs.length,
      limit
    })

    return twizzs.map((t, idx) => ({
      twizz_id: t._id!,
      score: 1 - idx * 0.01,
      reason: 'Bài viết từ người bạn đang theo dõi',
      algorithm: 'following' as const
    }))
  }

  /**
   * Lấy bài viết trending trong TRENDING_DAYS ngày gần nhất.
   */
  private async getTrendingTwizzs(userId: string, limit: number, excludeIds: Set<string>): Promise<ScoredItem[]> {

    // Bước 1: Xác định mốc thời gian (ví dụ: chỉ lấy bài trong TRENDING_DAYS ngày gần đây)
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - TRENDING_DAYS)

    const pipeline = [
      // Bước 2: Lọc các bài viết thỏa mãn điều kiện cơ bản
      {
        $match: {
          type: { $in: [TwizzType.Twizz, TwizzType.QuoteTwizz] },// Lấy bài gốc và bài Quote, không lấy comment
          audience: TwizzAudience.Everyone, // Chỉ bài public
          user_id: { $ne: new ObjectId(userId) }, // Không lấy bài của chính người đang xem
          created_at: { $gte: fromDate } // Nằm trong khoảng thời gian Trending
        }
      },
      // Bước 3: Đếm số lượng Like (Join với bảng likes)
      {
        $lookup: {
          from: process.env.DB_LIKES_COLLECTION,
          localField: '_id',
          foreignField: 'twizz_id',
          as: 'likes_data'
        }
      },
      // Bước 4: Đếm số lượng Comment (Join với bảng twizzs nhưng lọc loại Comment)
      {
        $lookup: {
          from: process.env.DB_TWIZZS_COLLECTION,
          let: { twizz_id: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$parent_id', '$$twizz_id'] }, { $eq: ['$type', TwizzType.Comment] }] }
              }
            }
          ],
          as: 'comments_data'
        }
      },
      // Bước 5: Đếm số lượng Quote (Join với bảng twizzs nhưng lọc loại QuoteTwizz)
      {
        $lookup: {
          from: process.env.DB_TWIZZS_COLLECTION,
          let: { twizz_id: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ['$parent_id', '$$twizz_id'] }, { $eq: ['$type', TwizzType.QuoteTwizz] }] }
              }
            }
          ],
          as: 'quotes_data'
        }
      },
      // Bước 6: Chuyển đổi mảng dữ liệu thành các con số và tính độ cũ của bài viết
      {
        $addFields: {
          like_count: { $size: '$likes_data' },
          comment_count: { $size: '$comments_data' },
          quote_count: { $size: '$quotes_data' },
          days_ago: {
            // Tính số ngày kể từ khi đăng: (Bây giờ - Ngày đăng) / (mili giây trong 1 ngày)
            $divide: [{ $subtract: [new Date(), '$created_at'] }, 1000 * 60 * 60 * 24]
          }
        }
      },
      // Bước 7: THUẬT TOÁN TRENDING SCORE (Công thức trọng số + Suy giảm theo thời gian)
      {
        $addFields: {
          trending_score: {
            $multiply: [
              // Phần A: Tổng điểm tương tác có trọng số
              {
                $add: [
                  { $multiply: ['$like_count', TRENDING_WEIGHTS.like] },
                  { $multiply: ['$comment_count', TRENDING_WEIGHTS.comment] },
                  { $multiply: ['$quote_count', TRENDING_WEIGHTS.quote] }
                ]
              },
              // Phần B: Hệ số suy giảm (Gravity) - Bài càng cũ thì chia cho số càng lớn -> điểm càng thấp
              { $divide: [1, { $add: [1, '$days_ago'] }] }
            ]
          }
        }
      },
      // Bước 8: Sắp xếp theo điểm cao nhất lên đầu
      { $sort: { trending_score: -1 } },
      // Bước 9: Lấy dư ra một chút (limit * 3) để lát nữa lọc bỏ bài trùng/bài đã xem
      { $limit: limit * 3 },
      { $project: { _id: 1, trending_score: 1 } }
    ]

    const results = await databaseService.twizzs.aggregate(pipeline).toArray()

    // Bước 10: Loại bỏ những bài mà user đã xem hoặc cần loại trừ
    const filtered = results.filter((r) => !excludeIds.has(r._id!.toString()))
    // Bước 11: Chuẩn hóa điểm số (Normalize) về khoảng [0, 1]
    const maxScore = filtered[0]?.trending_score ?? 1

    recoLog('Orchestrator', 'getTrendingTwizzs', {
      userId,
      limit,
      excludeCount: excludeIds.size,
      pipelineRaw: results.length,
      sauLọcExclude: filtered.length,
      maxTrendingScore: maxScore
    })

    return filtered.slice(0, limit).map((r) => ({
      twizz_id: r._id!,
      // Điểm = Điểm hiện tại / Điểm cao nhất
      score: maxScore > 0 ? r.trending_score / maxScore : 0,
      reason: 'Bài viết đang được nhiều người quan tâm',
      algorithm: 'trending' as const
    }))
  }

  /**
   * Loại bỏ trùng lặp và đa dạng hóa kết quả.
   */
  private deduplicateAndDiversify(items: ScoredItem[], limit: number): ScoredItem[] {
    // seenIds dùng để ghi nhớ: "ID này đã xuất hiện ở vị trí nào trong mảng deduplicated chưa?"
    const seenIds = new Map<string, number>()
    const deduplicated: ScoredItem[] = []


    // Bước 1: Lặp qua từng bài viết trong danh sách thô (thường là gộp từ nhiều thuật toán)
    for (const item of items) {
      const key = item.twizz_id.toString()
      const existingIdx = seenIds.get(key)

      // Nếu bài viết này đã tồn tại trong danh sách rồi (bị trùng) 
      if (existingIdx !== undefined) {
        // KIỂM TRA ĐIỂM SỐ: Nếu bài mới này có điểm cao hơn bài cũ đã lưu
        // (Ví dụ: Thuật toán Content-Based chấm 0.9, còn Trending chỉ chấm 0.5)
        if (item.score > deduplicated[existingIdx].score) {
          // Thì cập nhật bằng bài có điểm cao hơn để giữ lợi ích tốt nhất cho user
          deduplicated[existingIdx] = item
        }
      } else {
        // Nếu bài viết chưa từng xuất hiện:
        // Lưu vị trí của nó vào Map để lát nữa nếu gặp lại thì biết bài này nằm ở đâu
        seenIds.set(key, deduplicated.length)
        // Thêm bài viết vào danh sách kết quả
        deduplicated.push(item)
      }
    }

    // Bước 2: Sắp xếp lại toàn bộ danh sách đã lọc trùng theo điểm số giảm dần
    // Điều này đảm bảo những bài "xịn" nhất luôn lên đầu sau khi đã gộp các nguồn
    deduplicated.sort((a, b) => b.score - a.score)

    // Bước 3: Cắt danh sách theo đúng số lượng (limit) mà hệ thống yêu cầu (ví dụ: 60 bài)
    const out = deduplicated.slice(0, limit)
    recoLog('Orchestrator', 'deduplicateAndDiversify', {
      đầuVào: items.length, // Tổng số bài trước khi lọc
      sauGộpTrùng: deduplicated.length, // Số bài còn lại sau khi xóa trùng
      sauCắtLimit: out.length, // Số bài thực tế trả về
      limit // Số bài tối đa được trả về
    })
    return out
  }

  /**
   * Tạo InternalResult chuẩn.
   */
  private buildInternalResult(
    items: ScoredItem[],
    counts: { content?: number; collaborative?: number; trending?: number; following?: number },
    startTime: number
  ): InternalResult {
    return {
      items,
      meta: {
        total_recommended: items.length,
        content_based_count: counts.content ?? 0,
        collaborative_count: counts.collaborative ?? 0,
        trending_count: counts.trending ?? 0,
        following_count: counts.following ?? 0,
        processing_time_ms: Date.now() - startTime
      }
    }
  }

  /**
   * Xóa cache của user khi có tương tác mới.
   */
  invalidateUserCache(userId: string): void {
    recoLog('Orchestrator', 'invalidateUserCache', { userId })
    this.scoredCache.delete(userId)
    contentBasedService.invalidateUserCache(userId)
    collaborativeFilteringService.invalidateUserSimilarityCache(userId)
  }
}

const recommendationService = new RecommendationService()
export default recommendationService
