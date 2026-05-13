import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { TokenPayload } from '~/models/requests/User.requests'
import recommendationService from '~/services/recommendations.services'
import { RECOMMENDATION_MESSAGES } from '~/constants/messages'
import { recoLog } from '~/utils/recommendationLogger'

/**
 * Lấy gợi ý bài viết cá nhân hóa cho user đang đăng nhập.
 * Hỗ trợ phân trang (page) và giới hạn số lượng (limit).
 *
 * @method GET /recommendations
 * @header Authorization: Bearer <access_token>
 * @query limit - Số lượng bài viết mỗi trang (mặc định 20, tối đa 50)
 * @query page  - Trang hiện tại (mặc định 1)
 */
export const getRecommendationsController = async (
  req: Request<ParamsDictionary, any, any, { limit?: string; page?: string }>,
  res: Response
) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const limit = Math.min(Number(req.query.limit) || 20, 50)
  const page = Math.max(Number(req.query.page) || 1, 1)

  console.log('=========================Start recommendations controller=========================')
  recoLog('API', 'GET /recommendations', { user_id, limit, page })

  const result = await recommendationService.getHybridRecommendations(user_id, limit, page)

  recoLog('API', 'GET /recommendations hoàn tất', {
    user_id,
    trảVề: result.twizzs.length,
    page: result.page,
    total_page: result.total_page,
    processing_ms: result.metadata.processing_time_ms
  })

  return res.json({
    message: RECOMMENDATION_MESSAGES.GET_RECOMMENDATIONS_SUCCESSFULLY,
    result
  })
}

/**
 * Xóa cache gợi ý của user (dùng khi cần làm mới ngay lập tức).
 *
 * @method DELETE /recommendations/cache
 * @header Authorization: Bearer <access_token>
 */
export const invalidateRecommendationCacheController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload

  recoLog('API', 'DELETE /recommendations/cache', { user_id })
  recommendationService.invalidateUserCache(user_id)

  return res.json({
    message: RECOMMENDATION_MESSAGES.CACHE_INVALIDATED_SUCCESSFULLY
  })
}

/**
 * Đánh dấu danh sách bài viết đã xem.
 *
 * @method POST /recommendations/views
 * @header Authorization: Bearer <access_token>
 * @body twizz_ids - Mảng các ObjectId bài viết đã xem (tối đa 50)
 */
export const markViewedController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const { twizz_ids } = req.body

  // Validate twizz_ids
  if (!Array.isArray(twizz_ids) || twizz_ids.length === 0) {
    return res.status(400).json({
      message: RECOMMENDATION_MESSAGES.TWIZZ_IDS_MUST_BE_ARRAY
    })
  }

  if (twizz_ids.length > 50) {
    return res.status(400).json({
      message: RECOMMENDATION_MESSAGES.TWIZZ_IDS_TOO_MANY
    })
  }

  recoLog('API', 'POST /recommendations/views', { user_id, count: twizz_ids.length })
  await recommendationService.markTwizzsAsViewed(user_id, twizz_ids)

  return res.json({
    message: RECOMMENDATION_MESSAGES.MARK_VIEWED_SUCCESSFULLY
  })
}

export const resetFollowingViewedController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  await recommendationService.resetFollowingViewedTwizzs(user_id)
  return res.json({
    message: RECOMMENDATION_MESSAGES.RESET_FOLLOWING_VIEWED_SUCCESSFULLY
  })
}

export const resetAllViewedController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  await recommendationService.resetAllViewedTwizzs(user_id)
  return res.json({
    message: RECOMMENDATION_MESSAGES.RESET_ALL_VIEWED_SUCCESSFULLY
  })
}
