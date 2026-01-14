import { Router } from 'express'
import { createTwizzController } from '~/controllers/twizzs.controllers'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'
import { createTwizzValidator } from '~/middlewares/twizzs.middlewares'

const twizzsRouter = Router()

/**
 * @description Create a new twizz
 * @path /twizzs
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

export default twizzsRouter
