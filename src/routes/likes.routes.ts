import { Router } from 'express'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import { likeTwizzController } from '~/controllers/likes.controllers'
import { unlikeTwizzController } from '~/controllers/likes.controllers'
import { twizzIdValidator } from '~/middlewares/twizzs.middlewares'

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
  verifiedUserValidator,
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
  verifiedUserValidator,
  twizzIdValidator,
  wrapRequestHandler(unlikeTwizzController)
)
export default likesRouter
