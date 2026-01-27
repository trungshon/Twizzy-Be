import { Router } from 'express'
import { acceptConversationController, deleteConversationController, getConversationsController, getConversationsListController, markAsReadController } from '~/controllers/conservations.controllers'
import { paginationValidator } from '~/middlewares/twizzs.middlewares'
import { accessTokenValidator, getConversationsValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'

const conversationsRouter = Router()

/**
 * @description Get conversations list
 * @path /list
 * @method GET
 */
conversationsRouter.get('/list', accessTokenValidator, verifiedUserValidator, wrapRequestHandler(getConversationsListController))

/**
 * @description Get conversation messages
 * @path /receivers/:receiver_id
 * @method GET
 */
conversationsRouter.get('/receivers/:receiver_id', accessTokenValidator, verifiedUserValidator, paginationValidator, getConversationsValidator, wrapRequestHandler(getConversationsController))

/**
 * @description Accept conversation
 * @path /receivers/:sender_id/accept
 * @method PUT
 */
conversationsRouter.put('/receivers/:sender_id/accept', accessTokenValidator, verifiedUserValidator, wrapRequestHandler(acceptConversationController))

/**
 * @description Delete conversation
 * @path /receivers/:sender_id/delete
 * @method DELETE
 */
conversationsRouter.delete('/receivers/:sender_id/delete', accessTokenValidator, verifiedUserValidator, wrapRequestHandler(deleteConversationController))

/**
 * @description Mark as read
 * @path /receivers/:sender_id/mark-as-read
 * @method PATCH
 */
conversationsRouter.patch('/receivers/:sender_id/mark-as-read', accessTokenValidator, verifiedUserValidator, wrapRequestHandler(markAsReadController))

export default conversationsRouter