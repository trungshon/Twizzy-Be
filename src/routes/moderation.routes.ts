import { Router } from 'express'
import { moderateTextController } from '~/controllers/moderation.controllers'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'

const moderationRouter = Router()

/**
 * Description: Moderate text content
 * Path: /text
 * Method: POST
 * Body: { content: string }
 */
moderationRouter.post(
    '/text',
    accessTokenValidator,
    verifiedUserValidator,
    wrapRequestHandler(moderateTextController)
)

export default moderationRouter
