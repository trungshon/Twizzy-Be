import { Router } from 'express'
import {
  createTwizzController,
  getNewFeedsController,
  getTwizzChildrenController,
  getTwizzController,
  getUserTwizzsController
} from '~/controllers/twizzs.controllers'
import { accessTokenValidator, isUserLoggedInValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import {
  audienceValidator,
  createTwizzValidator,
  getTwizzChildrenValidator,
  paginationValidator,
  twizzIdValidator
} from '~/middlewares/twizzs.middlewares'

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

/**
 * @description Get twizz Children
 * @path /:twizz_id/children
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 *   twizz_type: TwizzType
 * }
 */
twizzsRouter.get(
  '/:twizz_id/children',
  twizzIdValidator,
  paginationValidator,
  getTwizzChildrenValidator,
  isUserLoggedInValidator(accessTokenValidator),
  isUserLoggedInValidator(verifiedUserValidator),
  audienceValidator,
  wrapRequestHandler(getTwizzChildrenController)
)

/**
 * @description Get new feeds
 * @path /
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 * }
 */
twizzsRouter.get(
  '/',
  paginationValidator,
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(getNewFeedsController)
)

/**
 * @description Get user's twizzs by type
 * @path /users/:user_id/twizzs
 * @method GET
 * @header {
 *   Authorization?: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 *   type?: TwizzType (0=Twizz, 1=Retwizz, 3=QuoteTwizz)
 * }
 */
twizzsRouter.get(
  '/users/:user_id/twizzs',
  paginationValidator,
  isUserLoggedInValidator(accessTokenValidator),
  isUserLoggedInValidator(verifiedUserValidator),
  wrapRequestHandler(getUserTwizzsController)
)

export default twizzsRouter
