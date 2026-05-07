import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import contentBasedService from './contentBased.services'
import collaborativeFilteringService from './collaborativeFiltering.services'
import { TwizzType, TwizzAudience } from '~/constants/enum'

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

// Trọng số Hybrid (Content-Based : Collaborative = 70 : 30)
const HYBRID_WEIGHTS = { content: 0.7, collaborative: 0.3 }

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

// Suppress unused warning
void EFFECTIVE_WEIGHTS

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

    // Kiểm tra cache (key = userId, không phụ thuộc limit/page)
    const cached = this.scoredCache.get(userId)
    if (cached && cached.expiredAt > Date.now()) {
      const totalPage = Math.max(1, Math.ceil(cached.items.length / limit))

      if (page <= totalPage) {
        // Pool chưa hết → phục vụ từ cache
        return this.paginateAndPopulate(cached.items, cached.meta, userId, limit, page)
      }

      // Pool cạn kiệt → xóa cache để tính lại
      this.scoredCache.delete(userId)
    }

    // Tính chỉ số tương tác để chọn chiến lược
    const { effectiveCount, distinctTwizzCount } = await this.computeEffectiveInteractions(userId)

    let internalResult: InternalResult

    if (effectiveCount === 0) {
      // Trường hợp 1: Chưa có tương tác nào -> Cold Start
      internalResult = await this.coldStartRecommendations(userId, RECOMMENDATION_POOL_SIZE, startTime)
    } else if (effectiveCount < EFFECTIVE_INTERACTION_THRESHOLD || distinctTwizzCount < MIN_DISTINCT_TWIZZ) {
      // Trường hợp 2: Ít tương tác -> Content-Based only
      internalResult = await this.contentBasedOnlyRecommendations(userId, RECOMMENDATION_POOL_SIZE, startTime)
    } else {
      // Trường hợp 3: Đủ tương tác -> Hybrid
      internalResult = await this.hybridRecommendations(userId, RECOMMENDATION_POOL_SIZE, startTime)
    }

    // Lưu cache scored items của pool mới
    this.scoredCache.set(userId, {
      items: internalResult.items,
      meta: internalResult.meta,
      expiredAt: Date.now() + this.SCORED_TTL
    })

    // Luôn trả về page 1 của pool mới (Flutter phát hiện qua response.page)
    return this.paginateAndPopulate(internalResult.items, internalResult.meta, userId, limit, 1)
  }

  /**
   * Phân trang từ scored items và populate dữ liệu đầy đủ từ MongoDB.
   */
  private async paginateAndPopulate(
    items: ScoredItem[],
    meta: RecommendationMeta,
    userId: string,
    limit: number,
    page: number
  ): Promise<PaginatedRecommendations> {
    const total = items.length
    const total_page = Math.max(1, Math.ceil(total / limit))
    const pageItems = items.slice((page - 1) * limit, page * limit)
    const twizzIds = pageItems.map((i) => i.twizz_id)
    const twizzs = await this.populateTwizzsByIds(twizzIds, userId)
    return { twizzs, limit, page, total_page, metadata: meta }
  }

  /**
   * Populate dữ liệu đầy đủ cho danh sách twizz_id.
   * Kết quả giữ nguyên thứ tự theo score (thứ tự của twizzIds đầu vào).
   */
  private async populateTwizzsByIds(twizzIds: ObjectId[], userId: string): Promise<any[]> {
    if (twizzIds.length === 0) return []

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
                          date_of_birth: 0
                        }
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
                    date_of_birth: 0
                  }
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
              date_of_birth: 0
            }
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

    // Giữ đúng thứ tự theo score (thứ tự của twizzIds đầu vào)
    const map = new Map(results.map((t: any) => [t._id.toString(), t]))
    return twizzIds
      .map((id) => {
        const doc = map.get(id.toString())
        if (doc) {
          doc.updated_at = date
          doc.user_views = (doc.user_views ?? 0) + 1
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
    return { effectiveCount, distinctTwizzCount }
  }

  /**
   * Cold Start: user chưa có tương tác nào.
   */
  private async coldStartRecommendations(userId: string, limit: number, startTime: number): Promise<InternalResult> {
    const followingCount = await databaseService.followers.countDocuments({
      user_id: new ObjectId(userId)
    })

    let followingItems: ScoredItem[] = []
    let trendingItems: ScoredItem[] = []

    if (followingCount > 0) {
      const followingLimit = Math.ceil(limit * COLD_START_FOLLOW_WEIGHTS.following)
      const trendingLimit = limit - followingLimit

      followingItems = await this.getFollowingTwizzs(userId, followingLimit)
      trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, new Set())
    } else {
      trendingItems = await this.getTrendingTwizzs(userId, limit, new Set())
    }

    const combined = [...followingItems, ...trendingItems]
    const deduplicated = this.deduplicateAndDiversify(combined, limit)

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
      trendingItems = await this.getTrendingTwizzs(userId, remaining, excludeIds)
    }

    const combined = [...contentItems, ...trendingItems]
    const deduplicated = this.deduplicateAndDiversify(combined, limit)

    return this.buildInternalResult(
      deduplicated,
      { content: contentItems.length, trending: trendingItems.length },
      startTime
    )
  }

  /**
   * Hybrid: kết hợp Content-Based (70%) và Collaborative (30%).
   */
  private async hybridRecommendations(userId: string, limit: number, startTime: number): Promise<InternalResult> {
    const [contentResults, collaborativeResults] = await Promise.all([
      contentBasedService.getRecommendations(userId, limit),
      collaborativeFilteringService.getRecommendations(userId, limit)
    ])

    let contentCount = 0
    let collaborativeCount = 0

    // Fallback khi không tìm được similar users
    if (collaborativeResults.length === 0) {
      const contentItems: ScoredItem[] = contentResults.map((r) => ({
        twizz_id: r.twizz_id,
        score: r.score * FALLBACK_WEIGHTS.content,
        reason: r.reason,
        algorithm: 'content' as const
      }))

      const excludeIds = new Set(contentItems.map((t) => t.twizz_id.toString()))
      const trendingLimit = Math.ceil(limit * FALLBACK_WEIGHTS.trending)
      const trendingItems = await this.getTrendingTwizzs(userId, trendingLimit, excludeIds)

      const combined = [...contentItems, ...trendingItems]
      const deduplicated = this.deduplicateAndDiversify(combined, limit)

      return this.buildInternalResult(
        deduplicated,
        { content: contentItems.length, trending: trendingItems.length },
        startTime
      )
    }

    // Tổng hợp điểm số Hybrid
    const scoreMap = new Map<string, { contentScore: number; collaborativeScore: number; reason: string }>()

    for (const r of contentResults) {
      const key = r.twizz_id.toString()
      scoreMap.set(key, { contentScore: r.score, collaborativeScore: 0, reason: r.reason })
    }

    for (const r of collaborativeResults) {
      const key = r.twizz_id.toString()
      const existing = scoreMap.get(key)
      if (existing) {
        existing.collaborativeScore = r.score
      } else {
        scoreMap.set(key, { contentScore: 0, collaborativeScore: r.score, reason: r.reason })
      }
    }

    // Tính final_score = 0.7 * content + 0.3 * collaborative
    const hybridItems: ScoredItem[] = []
    for (const [twizzIdStr, scores] of scoreMap.entries()) {
      const finalScore =
        HYBRID_WEIGHTS.content * scores.contentScore + HYBRID_WEIGHTS.collaborative * scores.collaborativeScore

      const hasContent = scores.contentScore > 0
      const hasCollab = scores.collaborativeScore > 0

      if (hasContent) contentCount++
      if (hasCollab) collaborativeCount++

      hybridItems.push({
        twizz_id: new ObjectId(twizzIdStr),
        score: finalScore,
        reason:
          hasContent && hasCollab
            ? 'Phù hợp với sở thích của bạn và được nhiều người tương tự yêu thích'
            : scores.reason,
        algorithm: hasContent && hasCollab ? 'hybrid' : hasContent ? 'content' : 'collaborative'
      })
    }

    hybridItems.sort((a, b) => b.score - a.score)
    const deduplicated = this.deduplicateAndDiversify(hybridItems, limit)

    return this.buildInternalResult(
      deduplicated,
      { content: contentCount, collaborative: collaborativeCount },
      startTime
    )
  }

  /**
   * Lấy bài viết từ những người user đang follow.
   */
  private async getFollowingTwizzs(userId: string, limit: number): Promise<ScoredItem[]> {
    const following = await databaseService.followers
      .find({ user_id: new ObjectId(userId) }, { projection: { followed_user_id: 1 } })
      .toArray()

    if (following.length === 0) return []

    const followedIds = following.map((f) => f.followed_user_id)

    const twizzs = await databaseService.twizzs
      .find({
        user_id: { $in: followedIds },
        type: TwizzType.Twizz,
        audience: TwizzAudience.Everyone
      })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

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
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - TRENDING_DAYS)

    const pipeline = [
      {
        $match: {
          type: TwizzType.Twizz,
          audience: TwizzAudience.Everyone,
          user_id: { $ne: new ObjectId(userId) },
          created_at: { $gte: fromDate }
        }
      },
      {
        $lookup: {
          from: process.env.DB_LIKES_COLLECTION,
          localField: '_id',
          foreignField: 'twizz_id',
          as: 'likes_data'
        }
      },
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
      {
        $addFields: {
          like_count: { $size: '$likes_data' },
          comment_count: { $size: '$comments_data' },
          quote_count: { $size: '$quotes_data' },
          days_ago: {
            $divide: [{ $subtract: [new Date(), '$created_at'] }, 1000 * 60 * 60 * 24]
          }
        }
      },
      {
        $addFields: {
          trending_score: {
            $multiply: [
              {
                $add: [
                  { $multiply: ['$like_count', TRENDING_WEIGHTS.like] },
                  { $multiply: ['$comment_count', TRENDING_WEIGHTS.comment] },
                  { $multiply: ['$quote_count', TRENDING_WEIGHTS.quote] }
                ]
              },
              { $divide: [1, { $add: [1, '$days_ago'] }] }
            ]
          }
        }
      },
      { $sort: { trending_score: -1 } },
      { $limit: limit * 3 },
      { $project: { _id: 1, trending_score: 1 } }
    ]

    const results = await databaseService.twizzs.aggregate(pipeline).toArray()

    const filtered = results.filter((r) => !excludeIds.has(r._id!.toString()))
    const maxScore = filtered[0]?.trending_score ?? 1

    return filtered.slice(0, limit).map((r) => ({
      twizz_id: r._id!,
      score: maxScore > 0 ? r.trending_score / maxScore : 0,
      reason: 'Bài viết đang được nhiều người quan tâm',
      algorithm: 'trending' as const
    }))
  }

  /**
   * Loại bỏ trùng lặp và đa dạng hóa kết quả.
   */
  private deduplicateAndDiversify(items: ScoredItem[], limit: number): ScoredItem[] {
    const seenIds = new Map<string, number>()
    const deduplicated: ScoredItem[] = []

    for (const item of items) {
      const key = item.twizz_id.toString()
      const existingIdx = seenIds.get(key)
      if (existingIdx !== undefined) {
        if (item.score > deduplicated[existingIdx].score) {
          deduplicated[existingIdx] = item
        }
      } else {
        seenIds.set(key, deduplicated.length)
        deduplicated.push(item)
      }
    }

    deduplicated.sort((a, b) => b.score - a.score)
    return deduplicated.slice(0, limit)
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
    this.scoredCache.delete(userId)
    contentBasedService.invalidateUserCache(userId)
    collaborativeFilteringService.invalidateUserSimilarityCache(userId)
  }
}

const recommendationService = new RecommendationService()
export default recommendationService
