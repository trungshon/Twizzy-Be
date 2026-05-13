import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import contentBasedService, { ContentBasedResult } from './contentBased.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả gợi ý trung gian (chỉ lưu ID + điểm số, chưa populate)
interface ScoredItem {
  twizz_id: ObjectId
  score: number
  reason: string
  algorithm: 'content' | 'trending' | 'following'
}

// Metadata về kết quả gợi ý
interface RecommendationMeta {
  total_recommended: number
  content_based_count: number
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
  global_total: number
  metadata: RecommendationMeta
}

// Trọng số tính effective_interactions (nhất quán với contentBased.services.ts)
const EFFECTIVE_WEIGHTS = { like: 1.0, comment: 1.2, quote: 1.5 }

// Ngưỡng và tỷ lệ cho chiến lược chuyển đổi mềm (Soft Transition)
const EFFECTIVE_THRESHOLD = 5 // Ngưỡng để trở thành Active User
const WARM_UP_RATIO = 0.3 // 30% Content-Based cho người mới (1-5 interactions)
const ACTIVE_RATIO = 0.7 // 70% Content-Based cho người dùng tích cực (>5)

// Tỉ lệ mặc định cho Cold Start (Following:Trending)
const PRIMARY_RATIO = 0.7

// Trọng số Cold Start khi có follow
const COLD_START_FOLLOW_WEIGHTS = { following: 0.7, trending: 0.3 }

// Trọng số tính trending score
const TRENDING_WEIGHTS = { like: 1.0, comment: 0.8, quote: 1.2 }

// Số ngày lookback khi tính trending
const TRENDING_DAYS = 7

// Số bài tối đa trong pool gợi ý (để phân trang)
const RECOMMENDATION_POOL_SIZE = 60

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
      // Xử lý Pool cạn kiệt: Nếu số lượng bài còn lại sau khi tỉa ít hơn limit, xóa cache để tạo Pool mới
      if (cached.items.length < limit) {
        recoLog('Orchestrator', 'Pool cạn kiệt do đã xem hết, xóa cache để tạo mới', {
          userId,
          limit,
          remaining: cached.items.length
        })
        this.scoredCache.delete(userId)
      } else {
        const totalPage = Math.max(1, Math.ceil(cached.items.length / limit))

        const global_total = await databaseService.twizzs.estimatedDocumentCount()

        if (page <= totalPage) {
          // Pool chưa hết → phục vụ từ cache
          recoLog('Orchestrator', 'Dùng pool đã cache (trang nằm trong pool)', {
            userId,
            page,
            totalPage,
            sốBàiTrongPool: cached.items.length,
            ttlCòn_ms: cached.expiredAt - Date.now()
          })
          return this.paginateAndPopulate(cached.items, cached.meta, userId, limit, page, startTime, global_total)
        }

        // Pool hết trang → xóa cache để tính lại
        recoLog('Orchestrator', 'Pool hết trang → xóa cache, sẽ tính lại pool mới', {
          userId,
          pageYêuCầu: page,
          totalPageTrướcĐó: totalPage,
          limit
        })
        this.scoredCache.delete(userId)
      }
    } else if (cached) {
      recoLog('Orchestrator', 'Cache pool hết hạn TTL', { userId })
      this.scoredCache.delete(userId)
    }

    // Tính chỉ số tương tác và lấy danh sách ID đã tương tác
    const { effectiveCount, interactedMap } = await this.computeEffectiveInteractions(userId)
    const interactedIds = new Set(interactedMap.keys())

    // Lấy danh sách bài đã xem (7 ngày gần nhất)
    const viewedIds = await this.getViewedTwizzIds(userId)

    // Gộp tất cả bài cần loại trừ: đã tương tác + đã xem
    const excludeIds = new Set([...interactedIds, ...viewedIds])

    recoLog('Orchestrator', 'Chỉ số tương tác', {
      effectiveCount,
      interactedCount: interactedIds.size,
      viewedCount: viewedIds.size,
      totalExcluded: excludeIds.size
    })

    let internalResult: InternalResult

    if (effectiveCount === 0) {
      // Chưa có tương tác nào → Cold Start (Following 70% + Trending 30%)
      recoLog('Orchestrator', 'Chiến lược: Cold Start (0 tương tác)', { userId })
      internalResult = await this.coldStartRecommendations(userId, RECOMMENDATION_POOL_SIZE, limit, excludeIds, startTime)
    } else {
      // Có tương tác → Áp dụng chuyển đổi mềm (Soft Transition)
      const ratio = effectiveCount < EFFECTIVE_THRESHOLD ? WARM_UP_RATIO : ACTIVE_RATIO
      recoLog('Orchestrator', 'Chiến lược: Hybrid (Content + Trending)', {
        userId,
        effectiveCount,
        ratio,
        ngưỡng: EFFECTIVE_THRESHOLD
      })
      internalResult = await this.contentTrendingRecommendations(userId, RECOMMENDATION_POOL_SIZE, limit, excludeIds, startTime, ratio)
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

    const global_total = await databaseService.twizzs.estimatedDocumentCount()

    // Luôn trả về page 1 của pool mới (Flutter phát hiện qua response.page)
    recoLog('Orchestrator', 'Trả về trang 1 của pool mới (sau khi tính lại)', { userId, limit })
    return this.paginateAndPopulate(internalResult.items, internalResult.meta, userId, limit, 1, startTime, global_total)
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
    startTime: number,
    global_total: number
  ): Promise<PaginatedRecommendations> {
    const total = items.length
    // Khi pool rỗng (đã xem hết), trả về total_page = 0
    // để Flutter nhận biết trạng thái "Caught Up" thay vì lặp lại
    const total_page = total === 0 ? 0 : Math.max(1, Math.ceil(total / limit))
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
      global_total,
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
  ): Promise<{ effectiveCount: number; distinctTwizzCount: number; interactedMap: Map<string, number> }> {
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

    return { effectiveCount, distinctTwizzCount, interactedMap }
  }

  /**
   * Cold Start: user chưa có tương tác nào.
   * Following (70%) + Trending (30%) per page, slot-filling.
   */
  private async coldStartRecommendations(
    userId: string,
    poolSize: number,
    pageLimit: number,
    interactedIds: Set<string>,
    startTime: number
  ): Promise<InternalResult> {
    const followingCount = await databaseService.followers.countDocuments({
      user_id: new ObjectId(userId)
    })

    recoLog('Orchestrator', 'coldStartRecommendations', { userId, followingCount, poolSize })

    let followingItems: ScoredItem[] = []
    let trendingItems: ScoredItem[] = []

    if (followingCount > 0) {
      // Lấy following (70% pool) và trending (30% pool)
      const followingLimit = Math.ceil(poolSize * COLD_START_FOLLOW_WEIGHTS.following)
      const trendingLimit = poolSize - followingLimit

      recoLog('Orchestrator', 'Cold Start: user có follow → following + trending', {
        userId,
        followingCount,
        followingLimit,
        trendingLimit
      })

      followingItems = await this.getFollowingTwizzs(userId, followingLimit, interactedIds)
      const excludeIds = new Set([...interactedIds, ...followingItems.map((t) => t.twizz_id.toString())])
      trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, excludeIds)

      // Xen kẽ 70:30 per page (14 following + 6 trending)
      // Xen kẽ mặc định 70:30 cho Cold Start (Following:Trending)
      const interleaved = this.interleaveResults(followingItems, trendingItems, pageLimit, poolSize, PRIMARY_RATIO)

      recoLog('Orchestrator', 'Cold Start: sau interleave', {
        userId,
        following_raw: followingItems.length,
        trending_raw: trendingItems.length,
        sauInterleave: interleaved.length
      })

      return this.buildInternalResult(
        interleaved,
        { following: followingItems.length, trending: trendingItems.length },
        startTime
      )
    } else {
      // Không follow ai → chỉ trending
      recoLog('Orchestrator', 'Cold Start: user không follow ai → chỉ trending', { userId, poolSize })
      trendingItems = await this.getTrendingTwizzs(userId, poolSize, interactedIds)

      const deduplicated = this.deduplicateAndDiversify(trendingItems, poolSize)

      recoLog('Orchestrator', 'Cold Start: sau dedupe (chỉ trending)', {
        userId,
        trending_raw: trendingItems.length,
        sauDedupe: deduplicated.length
      })

      return this.buildInternalResult(
        deduplicated,
        { trending: trendingItems.length },
        startTime
      )
    }
  }

  /**
   * Content + Trending: user đã có tương tác (effectiveCount > 0).
   * Content-Based (70%) + Trending (30%) per page, slot-filling.
   */
  private async contentTrendingRecommendations(
    userId: string,
    poolSize: number,
    pageLimit: number,
    interactedIds: Set<string>,
    startTime: number,
    ratio: number
  ): Promise<InternalResult> {
    // Lấy content (theo ratio) và trending (phần còn lại)
    const contentLimit = Math.ceil(poolSize * ratio)
    const trendingLimit = poolSize - contentLimit

    recoLog('Orchestrator', 'Content+Trending: gọi song song', {
      userId,
      poolSize,
      pageLimit,
      contentLimit,
      trendingLimit
    })

    const contentResults = await contentBasedService.getRecommendations(userId, contentLimit, interactedIds)

    const contentItems: ScoredItem[] = contentResults.map((r) => ({
      twizz_id: r.twizz_id,
      score: r.score,
      reason: r.reason,
      algorithm: 'content' as const
    }))

    // Trending lấy thêm, loại trùng với content và bài đã tương tác
    const excludeIds = new Set([...interactedIds, ...contentItems.map((t) => t.twizz_id.toString())])
    const trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, excludeIds)

    recoLog('Orchestrator', 'Content+Trending: kết quả thô', {
      userId,
      contentCount: contentItems.length,
      trendingCount: trendingItems.length
    })

    // Xen kẽ theo ratio trên từng trang
    const interleaved = this.interleaveResults(contentItems, trendingItems, pageLimit, poolSize, ratio)

    // Đếm lại số lượng từ mỗi nguồn sau khi interleave
    let contentCount = 0
    let trendingCount = 0
    interleaved.forEach((item) => {
      if (item.algorithm === 'content') contentCount++
      if (item.algorithm === 'trending') trendingCount++
    })

    recoLog('Orchestrator', 'Content+Trending: sau interleave (70:30)', {
      userId,
      sauInterleave: interleaved.length,
      contentCount,
      trendingCount
    })

    return this.buildInternalResult(
      interleaved,
      { content: contentCount, trending: trendingCount },
      startTime
    )
  }

  /**
   * Xen kẽ 2 nguồn bài theo tỉ lệ 70:30 trên từng trang (Slot-filling).
   *
   * @param primaryItems  Nguồn chính (Content hoặc Following)
   * @param secondaryItems Nguồn phụ (Trending)
   * @param pageLimit     Kích thước trang thực tế (VD: 20)
   * @param maxPool       Số bài tối đa trong pool (VD: 60)
   */
  private interleaveResults(
    primaryItems: ScoredItem[],
    secondaryItems: ScoredItem[],
    pageLimit: number,
    maxPool: number,
    ratio: number = PRIMARY_RATIO
  ): ScoredItem[] {
    const finalPool: ScoredItem[] = []

    // Tỉ lệ mỗi trang dựa trên ratio truyền vào
    const primaryPerPage = Math.ceil(pageLimit * ratio)
    const secondaryPerPage = pageLimit - primaryPerPage

    let pIdx = 0
    let sIdx = 0

    // Điền vào pool theo từng "trang" ảo
    while (finalPool.length < maxPool && (pIdx < primaryItems.length || sIdx < secondaryItems.length)) {
      // 1. Fill Primary slots cho trang hiện tại
      for (let i = 0; i < primaryPerPage && finalPool.length < maxPool; i++) {
        if (pIdx < primaryItems.length) finalPool.push(primaryItems[pIdx++])
      }
      // 2. Fill Secondary slots cho trang hiện tại
      for (let i = 0; i < secondaryPerPage && finalPool.length < maxPool; i++) {
        if (sIdx < secondaryItems.length) {
          finalPool.push(secondaryItems[sIdx++])
        } else if (pIdx < primaryItems.length) {
          // Nếu hết bài Secondary, lấy thêm bài Primary để lấp chỗ trống
          finalPool.push(primaryItems[pIdx++])
        }
      }
    }

    return finalPool
  }

  /**
   * Lấy bài viết từ những người user đang follow.
   */
  private async getFollowingTwizzs(userId: string, limit: number, excludeIds: Set<string>): Promise<ScoredItem[]> {
    const userObjectId = new ObjectId(userId)
    const following = await databaseService.followers
      .find({ user_id: userObjectId }, { projection: { followed_user_id: 1 } })
      .toArray()

    if (following.length === 0) {
      recoLog('Orchestrator', 'getFollowingTwizzs: không có follow', { userId })
      return []
    }

    const followedIds = following.map((f) => f.followed_user_id)
    const excludeObjectIds = Array.from(excludeIds).map(id => new ObjectId(id))

    const pipeline = [
      {
        $match: {
          user_id: { $in: followedIds },
          _id: { $nin: excludeObjectIds },
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

    const excludeObjectIds = Array.from(excludeIds).map(id => new ObjectId(id))

    const pipeline = [
      // Bước 2: Lọc các bài viết thỏa mãn điều kiện cơ bản
      {
        $match: {
          _id: { $nin: excludeObjectIds }, // Lọc bài đã tương tác
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
    counts: { content?: number; trending?: number; following?: number },
    startTime: number
  ): InternalResult {
    return {
      items,
      meta: {
        total_recommended: items.length,
        content_based_count: counts.content ?? 0,
        trending_count: counts.trending ?? 0,
        following_count: counts.following ?? 0,
        processing_time_ms: Date.now() - startTime
      }
    }
  }

  /**
   * Lưu danh sách bài viết đã xem vào DB.
   * Dùng bulkWrite với upsert để tránh trùng lặp.
   */
  async markTwizzsAsViewed(userId: string, twizzIds: string[]): Promise<void> {
    if (twizzIds.length === 0) return

    const userObjectId = new ObjectId(userId)
    const now = new Date()

    const operations = twizzIds.map((id) => ({
      updateOne: {
        filter: { user_id: userObjectId, twizz_id: new ObjectId(id) },
        update: {
          $setOnInsert: {
            user_id: userObjectId,
            twizz_id: new ObjectId(id),
            created_at: now
          }
        },
        upsert: true
      }
    }))

    await databaseService.recommendationViews.bulkWrite(operations, { ordered: false })

    // Tỉa cache trực tiếp: Loại bỏ bài vừa xem khỏi Pool hiện tại
    const cached = this.scoredCache.get(userId)
    if (cached) {
      const viewedSet = new Set(twizzIds)
      const originalLength = cached.items.length
      cached.items = cached.items.filter((item) => !viewedSet.has(item.twizz_id.toString()))

      recoLog('Orchestrator', 'Đã tỉa Cache sau khi user xem bài', {
        userId,
        bàiTrongCacheTrướcĐó: originalLength,
        bàiTrongCacheSauĐó: cached.items.length
      })
    }

    recoLog('Orchestrator', 'markTwizzsAsViewed', {
      userId,
      count: twizzIds.length
    })
  }

  /**
   * Lấy danh sách ID các bài viết user đã xem (Set<string>)
   */
  public async getViewedTwizzIds(userId: string, sessionStart?: string): Promise<Set<string>> {
    const userObjectId = new ObjectId(userId)
    const query: any = { user_id: userObjectId }

    if (sessionStart) {
      query.created_at = { $lte: new Date(sessionStart) }
    }

    const views = await databaseService.recommendationViews
      .find(
        query,
        { projection: { twizz_id: 1, _id: 0 } }
      )
      .toArray()

    const viewedIds = new Set(views.map((v) => v.twizz_id.toString()))

    recoLog('Orchestrator', 'getViewedTwizzIds', {
      userId,
      viewedCount: viewedIds.size
    })

    return viewedIds
  }

  /**
   * Xóa cache của user khi có tương tác mới.
   */
  invalidateUserCache(userId: string): void {
    recoLog('Orchestrator', 'invalidateUserCache', { userId })
    this.scoredCache.delete(userId)
    contentBasedService.invalidateUserCache(userId)
  }

  /**
   * Reset lịch sử đã xem cho các bài viết thuộc tab Following (những người đang theo dõi)
   */
  async resetFollowingViewedTwizzs(userId: string) {
    const userObjectId = new ObjectId(userId)

    // 1. Lấy danh sách ID những người đang theo dõi
    const followers = await databaseService.followers
      .find({ user_id: userObjectId }, { projection: { followed_user_id: 1, _id: 0 } })
      .toArray()
    const followedUserIds = followers.map((f) => f.followed_user_id)

    if (followedUserIds.length === 0) return

    // 2. Tìm tất cả twizz_id của những người đó mà user đã xem
    // Chúng ta có thể dùng aggregation để join và delete hoặc làm 2 bước
    const viewsToReset = await databaseService.recommendationViews
      .aggregate([
        {
          $match: { user_id: userObjectId }
        },
        {
          $lookup: {
            from: process.env.DB_TWIZZS_COLLECTION as string,
            localField: 'twizz_id',
            foreignField: '_id',
            as: 'twizz'
          }
        },
        {
          $unwind: '$twizz'
        },
        {
          $match: {
            'twizz.user_id': { $in: followedUserIds }
          }
        },
        {
          $project: { twizz_id: 1 }
        }
      ])
      .toArray()

    const twizzIdsToReset = viewsToReset.map((v) => v.twizz_id)

    if (twizzIdsToReset.length > 0) {
      // 3. Xoá các bản ghi đã xem này
      await databaseService.recommendationViews.deleteMany({
        user_id: userObjectId,
        twizz_id: { $in: twizzIdsToReset }
      })
    }
  }

  /**
   * Reset TẤT CẢ lịch sử đã xem (tab Đề xuất - For You)
   * Phương án : Nuclear Reset
   */
  async resetAllViewedTwizzs(userId: string) {
    const userObjectId = new ObjectId(userId)

    // 1. Xóa sạch DB
    await databaseService.recommendationViews.deleteMany({
      user_id: userObjectId
    })

    // 2. Xóa Cache để ép tính toán lại
    this.invalidateUserCache(userId)

    recoLog('Orchestrator', 'Đã reset TOÀN BỘ lịch sử đã xem (Nuclear Reset)', { userId })
  }
}

const recommendationService = new RecommendationService()
export default recommendationService
