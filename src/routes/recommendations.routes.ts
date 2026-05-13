import { Router } from 'express'
import { accessTokenValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import {
  getRecommendationsController,
  invalidateRecommendationCacheController,
  markViewedController,
  resetFollowingViewedController,
  resetAllViewedController
} from '~/controllers/recommendations.controllers'

const recommendationsRouter = Router()

/**
 * @description Lấy danh sách bài viết gợi ý cá nhân hóa (Hybrid Recommendation)
 * @path /recommendations
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @query {
 *   limit?: number  (mặc định 20, tối đa 50)
 * }
 */
recommendationsRouter.get('/', accessTokenValidator, wrapRequestHandler(getRecommendationsController))

/**
 * @description Xóa cache gợi ý của user hiện tại (làm mới ngay lập tức)
 * @path /recommendations/cache
 * @method DELETE
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
recommendationsRouter.delete(
  '/cache',
  accessTokenValidator,
  wrapRequestHandler(invalidateRecommendationCacheController)
)

/**
 * @description Đánh dấu bài viết đã xem (gọi từ App khi user lướt qua bài)
 * @path /recommendations/views
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   twizz_ids: string[]  (mảng ID bài viết, tối đa 50)
 * }
 */
recommendationsRouter.post(
  '/views',
  accessTokenValidator,
  wrapRequestHandler(markViewedController)
)

/**
 * Description: Reset lịch sử đã xem cho tab Following
 * Path: /views/following
 * Method: DELETE
 * Header: { Authorization: Bearer <access_token> }
 */
recommendationsRouter.delete(
  '/views/following',
  accessTokenValidator,
  wrapRequestHandler(resetFollowingViewedController)
)
/**
 * @description Reset TẤT CẢ lịch sử đã xem (For You tab)
 * @path /recommendations/views
 * @method DELETE
 * @header Authorization: Bearer <access_token>
 */
recommendationsRouter.delete(
  '/views',
  accessTokenValidator,
  wrapRequestHandler(resetAllViewedController)
)

export default recommendationsRouter
