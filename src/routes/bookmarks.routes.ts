import { Router } from 'express'
import {
  bookmarkTwizzController,
  unbookmarkTwizzController,
  getUserBookmarkedTwizzsController,
  getUsersWhoBookmarkedTwizzController
} from '~/controllers/bookmarks.controllers'
import { accessTokenValidator, verifiedUserValidator, isUserLoggedInValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import { twizzIdValidator, paginationValidator } from '~/middlewares/twizzs.middlewares'
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
  // verifiedUserValidator,
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
  // verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(unbookmarkTwizzController)
)

/**
 * @description Get user's bookmarked twizzs
 * @path /users/:user_id/bookmarked-twizzs
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 * }
 */
bookmarksRouter.get(
  '/users/:user_id/bookmarked-twizzs',
  paginationValidator,
  isUserLoggedInValidator(accessTokenValidator),
  // isUserLoggedInValidator(verifiedUserValidator),
  wrapRequestHandler(getUserBookmarkedTwizzsController)
)

/**
 * @description Get users who bookmarked a specific twizz
 * @path /twizzs/:twizz_id/users
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 * }
 */
bookmarksRouter.get(
  '/twizzs/:twizz_id/users',
  twizzIdValidator,
  paginationValidator,
  isUserLoggedInValidator(accessTokenValidator),
  wrapRequestHandler(getUsersWhoBookmarkedTwizzController)
)

export default bookmarksRouter
