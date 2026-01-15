import { Router } from 'express'
import { bookmarkTwizzController, unbookmarkTwizzController } from '~/controllers/bookmarks.controllers'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import { twizzIdValidator } from '~/middlewares/twizzs.middlewares'
import { audienceValidator } from '~/middlewares/twizzs.middlewares'

const bookmarksRouter = Router()

/**
 * @description Create a bookmark
 * @path /
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   twizz_id: string
 * }
 */
bookmarksRouter.post(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(bookmarkTwizzController)
)

/**
 * @description Unbookmark a twizz
 * @path /twizzs/:twizz_id
 * @method DELETE
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
bookmarksRouter.delete(
  '/twizzs/:twizz_id',
  accessTokenValidator,
  verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(unbookmarkTwizzController)
)
export default bookmarksRouter
