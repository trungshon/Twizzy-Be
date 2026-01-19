import { Router } from 'express'
import { accessTokenValidator, verifiedUserValidator, isUserLoggedInValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import {
  likeTwizzController,
  unlikeTwizzController,
  getUserLikedTwizzsController,
  getUsersWhoLikedTwizzController
} from '~/controllers/likes.controllers'
import { twizzIdValidator } from '~/middlewares/twizzs.middlewares'
import { paginationValidator } from '~/middlewares/twizzs.middlewares'

const likesRouter = Router()

/**
 * @description Like a twizz
 * @path /
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   twizz_id: string
 * }
 */
likesRouter.post(
  '/',
  accessTokenValidator,
  // verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(likeTwizzController)
)

/**
 * @description Unlike a twizz
 * @path /twizzs/:twizz_id
 * @method DELETE
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
likesRouter.delete(
  '/twizzs/:twizz_id',
  accessTokenValidator,
  // verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(unlikeTwizzController)
)

/**
 * @description Get user's liked twizzs
 * @path /users/:user_id/liked-twizzs
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 * }
 */
likesRouter.get(
  '/users/:user_id/liked-twizzs',
  paginationValidator,
  isUserLoggedInValidator(accessTokenValidator),
  // isUserLoggedInValidator(verifiedUserValidator),
  wrapRequestHandler(getUserLikedTwizzsController)
)

/**
 * @description Get users who liked a specific twizz
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
likesRouter.get(
  '/twizzs/:twizz_id/users',
  twizzIdValidator,
  paginationValidator,
  isUserLoggedInValidator(accessTokenValidator),
  wrapRequestHandler(getUsersWhoLikedTwizzController)
)

export default likesRouter
