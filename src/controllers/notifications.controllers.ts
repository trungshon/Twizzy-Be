import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { TokenPayload } from '~/models/requests/User.requests'
import notificationsService from '~/services/notifications.services'

export const getNotificationsController = async (req: Request<ParamsDictionary, any, any, any>, res: Response) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const limit = Number(req.query.limit) || 10
    const page = Number(req.query.page) || 1
    const result = await notificationsService.getNotifications(user_id, limit, page)
    return res.json({
        message: 'Get notifications successfully',
        result
    })
}

export const markAsReadController = async (req: Request, res: Response) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    const { notification_id } = req.params
    await notificationsService.markAsRead(notification_id, user_id)
    return res.json({
        message: 'Mark notification as read successfully'
    })
}

export const markAllAsReadController = async (req: Request, res: Response) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    await notificationsService.markAllAsRead(user_id)
    return res.json({
        message: 'Mark all notifications as read successfully'
    })
}

export const deleteReadNotificationsController = async (req: Request, res: Response) => {
    const { user_id } = req.decoded_authorization as TokenPayload
    await notificationsService.deleteReadNotifications(user_id)
    return res.json({
        message: 'Delete read notifications successfully'
    })
}
