import { Router } from 'express'
import {
    getNotificationsController,
    markAsReadController,
    markAllAsReadController,
    deleteReadNotificationsController
} from '~/controllers/notifications.controllers'
import { paginationValidator } from '~/middlewares/twizzs.middlewares'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'

const notificationsRouter = Router()

/**
 * @description Get notification history
 * @path /
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @query {
 *   limit: number
 *   page: number
 * }
 */
notificationsRouter.get(
    '/',
    accessTokenValidator,
    verifiedUserValidator,
    paginationValidator,
    wrapRequestHandler(getNotificationsController)
)

notificationsRouter.patch(
    '/:notification_id/read',
    accessTokenValidator,
    verifiedUserValidator,
    wrapRequestHandler(markAsReadController)
)

notificationsRouter.patch(
    '/mark-all-as-read',
    accessTokenValidator,
    verifiedUserValidator,
    wrapRequestHandler(markAllAsReadController)
)

notificationsRouter.delete(
    '/read',
    accessTokenValidator,
    verifiedUserValidator,
    wrapRequestHandler(deleteReadNotificationsController)
)

export default notificationsRouter
