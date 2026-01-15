import { Router } from 'express'
import { createTwizzController, getTwizzController } from '~/controllers/twizzs.controllers'
import { accessTokenValidator, isUserLoggedInValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import { audienceValidator, createTwizzValidator, twizzIdValidator } from '~/middlewares/twizzs.middlewares'

const twizzsRouter = Router()

/**
 * @description Create a new twizz
 * @path /
 * @method POST
 * @body {
 *   type: TwizzType
 *   audience: TwizzAudience
 *   content: string
 *   parent_id: null | string
 *   hashtags: string[]
 *   mentions: string[]
 *   medias: Media[]
 * }
 */
twizzsRouter.post(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  createTwizzValidator,
  wrapRequestHandler(createTwizzController)
)

/**
 * @description Get twizz detail
 * @path /:twizz_id
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 */
twizzsRouter.get(
  '/:twizz_id',
  twizzIdValidator,
  isUserLoggedInValidator(accessTokenValidator),
  isUserLoggedInValidator(verifiedUserValidator),
  audienceValidator,
  wrapRequestHandler(getTwizzController)
)

export default twizzsRouter
