import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import Notification from '~/models/schemas/Notification.schema'
import { NotificationType, TwizzType, TwizzAudience } from '~/constants/enum'
import { io, users } from '~/utils/socket'
import firebaseService from './firebase.services'

class NotificationsService {
    async createNotification(payload: {
        user_id: string // Recipient
        sender_id: string // Trigger user
        type: NotificationType
        twizz_id?: string
        metadata?: any
    }) {
        const filter: any = {
            user_id: new ObjectId(payload.user_id),
            sender_id: new ObjectId(payload.sender_id),
            type: payload.type
        }

        if (payload.twizz_id) {
            filter.twizz_id = new ObjectId(payload.twizz_id)
        } else {
            filter.twizz_id = { $exists: false }
        }

        const update: any = {
            $set: {
                is_read: false,
                created_at: new Date()
            }
        }

        if (payload.metadata) {
            update.$set.metadata = payload.metadata
        }

        const result = await databaseService.notifications.findOneAndUpdate(filter, update, {
            upsert: true,
            returnDocument: 'after'
        })

        const notificationId = result?._id as ObjectId | undefined

        // Populate và gửi qua socket + FCM
        if (notificationId) {
            const populatedNotification = await this.getNotificationById(notificationId.toString(), payload.user_id)
            if (populatedNotification) {
                // Gửi qua Socket.IO (cho app đang mở)
                const recipientSocketId = users[payload.user_id]?.socket_id
                if (recipientSocketId) {
                    io.to(recipientSocketId).emit('notification', populatedNotification)
                }

                // Gửi qua FCM (cho app ở background/tắt hẳn)
                const senderName = populatedNotification?.sender?.name || 'Ai đó'
                const fcmBody = this.getFcmBody(payload.type)
                await firebaseService.sendNotification({
                    user_id: payload.user_id,
                    title: senderName,
                    body: fcmBody,
                    data: {
                        type: payload.type.toString(),
                        notification_id: notificationId.toString(),
                        twizz_id: payload.twizz_id || '',
                        // Thêm thông tin sender cho navigation (follow → userProfile)
                        sender_id: payload.sender_id,
                        sender_username: populatedNotification?.sender?.username || '',
                        sender_name: populatedNotification?.sender?.name || '',
                        sender_avatar: populatedNotification?.sender?.avatar || '',
                        // Thêm report_id cho navigation (report → reportDetail)
                        report_id: payload.metadata?.report_id || '',
                    }
                })
            }
        }

        return result
    }

    async getNotificationById(id: string, viewer_id: string) {
        const notifications = await this.getNotificationsAggregation({
            match: { _id: new ObjectId(id) },
            viewer_id
        })
        return notifications[0] || null
    }

    async getNotifications(user_id: string, limit: number, page: number) {
        return this.getNotificationsAggregation({
            match: { user_id: new ObjectId(user_id) },
            viewer_id: user_id,
            limit,
            page
        })
    }

    async markAsRead(notification_id: string, user_id: string) {
        const result = await databaseService.notifications.updateOne(
            { _id: new ObjectId(notification_id), user_id: new ObjectId(user_id) },
            { $set: { is_read: true } }
        )
        return result
    }

    async markAllAsRead(user_id: string) {
        const result = await databaseService.notifications.updateMany(
            { user_id: new ObjectId(user_id), is_read: false },
            { $set: { is_read: true } }
        )
        return result
    }

    async deleteReadNotifications(user_id: string) {
        const result = await databaseService.notifications.deleteMany({
            user_id: new ObjectId(user_id),
            is_read: true
        })
        return result
    }

    private async getNotificationsAggregation({
        match,
        viewer_id,
        limit,
        page
    }: {
        match: any
        viewer_id: string
        limit?: number
        page?: number
    }) {
        const viewer_id_objectId = new ObjectId(viewer_id)
        const pipeline: any[] = [
            { $match: match },
            { $sort: { created_at: -1 } }
        ]

        if (page && limit) {
            pipeline.push({ $skip: (page - 1) * limit })
            pipeline.push({ $limit: limit })
        }

        pipeline.push(
            {
                $lookup: {
                    from: 'users',
                    localField: 'sender_id',
                    foreignField: '_id',
                    as: 'sender'
                }
            },
            { $unwind: '$sender' },
            {
                $addFields: {
                    sender: {
                        _id: '$sender._id',
                        name: '$sender.name',
                        username: '$sender.username',
                        avatar: '$sender.avatar',
                        verify: '$sender.verify'
                    }
                }
            },
            {
                $lookup: {
                    from: 'twizzs',
                    localField: 'twizz_id',
                    foreignField: '_id',
                    as: 'twizz'
                }
            },
            {
                $unwind: {
                    path: '$twizz',
                    preserveNullAndEmptyArrays: true
                }
            }
        )

        // Twizz Population (similar to getNewFeeds)
        pipeline.push(
            {
                $lookup: {
                    from: 'users',
                    localField: 'twizz.user_id',
                    foreignField: '_id',
                    as: 'twizz.user'
                }
            },
            {
                $unwind: {
                    path: '$twizz.user',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'hashtags',
                    localField: 'twizz.hashtags',
                    foreignField: '_id',
                    as: 'twizz.hashtags'
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'twizz.mentions',
                    foreignField: '_id',
                    as: 'twizz.mentions'
                }
            },
            {
                $addFields: {
                    'twizz.mentions': {
                        $map: {
                            input: '$twizz.mentions',
                            as: 'mention',
                            in: {
                                _id: '$$mention._id',
                                name: '$$mention.name',
                                username: '$$mention.username',
                                email: '$$mention.email'
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'bookmarks',
                    localField: 'twizz._id',
                    foreignField: 'twizz_id',
                    as: 'twizz.bookmarks'
                }
            },
            {
                $lookup: {
                    from: 'likes',
                    localField: 'twizz._id',
                    foreignField: 'twizz_id',
                    as: 'twizz.likes'
                }
            },
            {
                $lookup: {
                    from: 'twizzs',
                    localField: 'twizz._id',
                    foreignField: 'parent_id',
                    as: 'twizz.twizz_children'
                }
            },
            {
                $lookup: {
                    from: 'twizzs',
                    localField: 'twizz.parent_id',
                    foreignField: '_id',
                    as: 'twizz.parent_twizz',
                    pipeline: [
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'user_id',
                                foreignField: '_id',
                                as: 'user'
                            }
                        },
                        {
                            $unwind: {
                                path: '$user',
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        {
                            $lookup: {
                                from: 'twizzs',
                                localField: 'parent_id',
                                foreignField: '_id',
                                pipeline: [
                                    {
                                        $lookup: {
                                            from: 'users',
                                            localField: 'user_id',
                                            foreignField: '_id',
                                            as: 'user'
                                        }
                                    },
                                    {
                                        $unwind: {
                                            path: '$user',
                                            preserveNullAndEmptyArrays: true
                                        }
                                    },
                                    {
                                        $project: {
                                            user: {
                                                password: 0,
                                                email_verify_token: 0,
                                                email_verify_otp: 0,
                                                email_verify_otp_expires_at: 0,
                                                forgot_password_otp: 0,
                                                forgot_password_otp_expires_at: 0,
                                                forgot_password_token: 0,
                                                date_of_birth: 0
                                            }
                                        }
                                    }
                                ],
                                as: 'parent_twizz'
                            }
                        },
                        {
                            $unwind: {
                                path: '$parent_twizz',
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        {
                            $project: {
                                user: {
                                    password: 0,
                                    email_verify_token: 0,
                                    email_verify_otp: 0,
                                    email_verify_otp_expires_at: 0,
                                    forgot_password_token: 0,
                                    forgot_password_otp: 0,
                                    forgot_password_otp_expires_at: 0,
                                    date_of_birth: 0
                                }
                            }
                        }
                    ]
                }
            },
            {
                $addFields: {
                    'twizz.parent_twizz': { $arrayElemAt: ['$twizz.parent_twizz', 0] }
                }
            },
            {
                $lookup: {
                    from: 'likes',
                    localField: 'twizz._id',
                    foreignField: 'twizz_id',
                    as: 'twizz.user_likes',
                    pipeline: [
                        {
                            $match: {
                                user_id: viewer_id_objectId
                            }
                        }
                    ]
                }
            },
            {
                $lookup: {
                    from: 'bookmarks',
                    localField: 'twizz._id',
                    foreignField: 'twizz_id',
                    as: 'twizz.user_bookmarks',
                    pipeline: [
                        {
                            $match: {
                                user_id: viewer_id_objectId
                            }
                        }
                    ]
                }
            },
            {
                $addFields: {
                    'twizz.bookmarks': { $size: { $ifNull: ['$twizz.bookmarks', []] } },
                    'twizz.likes': { $size: { $ifNull: ['$twizz.likes', []] } },
                    'twizz.is_liked': { $gt: [{ $size: { $ifNull: ['$twizz.user_likes', []] } }, 0] },
                    'twizz.is_bookmarked': { $gt: [{ $size: { $ifNull: ['$twizz.user_bookmarks', []] } }, 0] },
                    'twizz.comment_count': {
                        $size: {
                            $filter: {
                                input: { $ifNull: ['$twizz.twizz_children', []] },
                                as: 'item',
                                cond: { $eq: ['$$item.type', TwizzType.Comment] }
                            }
                        }
                    },
                    'twizz.quote_count': {
                        $size: {
                            $filter: {
                                input: { $ifNull: ['$twizz.twizz_children', []] },
                                as: 'item',
                                cond: { $eq: ['$$item.type', TwizzType.QuoteTwizz] }
                            }
                        }
                    }
                }
            },
            {
                $addFields: {
                    twizz: {
                        $cond: {
                            if: { $gt: ['$twizz_id', null] },
                            then: '$twizz',
                            else: '$$REMOVE'
                        }
                    }
                }
            },
            {
                $addFields: {
                    'report_id_obj': {
                        $cond: {
                            if: { $and: [{ $ne: ['$metadata.report_id', null] }, { $ne: ['$metadata.report_id', ''] }] },
                            then: { $toObjectId: '$metadata.report_id' },
                            else: '$$REMOVE'
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'reports',
                    localField: 'report_id_obj',
                    foreignField: '_id',
                    as: 'report'
                }
            },
            {
                $unwind: {
                    path: '$report',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'twizzs',
                    localField: 'report.twizz_id',
                    foreignField: '_id',
                    as: 'report.twizz'
                }
            },
            {
                $unwind: {
                    path: '$report.twizz',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $addFields: {
                    'report.twizz': { $ifNull: ['$report.twizz', '$report.twizz_snapshot'] }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'report.twizz.user_id',
                    foreignField: '_id',
                    as: 'report.twizz.user'
                }
            },
            {
                $unwind: {
                    path: '$report.twizz.user',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'report.user_id',
                    foreignField: '_id',
                    as: 'report.reporter'
                }
            },
            {
                $unwind: {
                    path: '$report.reporter',
                    preserveNullAndEmptyArrays: true
                }
            },
            // Populate parent_twizz for report.twizz (2 levels)
            {
                $lookup: {
                    from: 'twizzs',
                    localField: 'report.twizz.parent_id',
                    foreignField: '_id',
                    as: 'report.twizz.parent_twizz',
                    pipeline: [
                        {
                            $lookup: {
                                from: 'users',
                                localField: 'user_id',
                                foreignField: '_id',
                                as: 'user'
                            }
                        },
                        {
                            $unwind: {
                                path: '$user',
                                preserveNullAndEmptyArrays: true
                            }
                        },
                        // Level 2: Grandparent
                        {
                            $lookup: {
                                from: 'twizzs',
                                localField: 'parent_id',
                                foreignField: '_id',
                                as: 'parent_twizz',
                                pipeline: [
                                    {
                                        $lookup: {
                                            from: 'users',
                                            localField: 'user_id',
                                            foreignField: '_id',
                                            as: 'user'
                                        }
                                    },
                                    {
                                        $unwind: {
                                            path: '$user',
                                            preserveNullAndEmptyArrays: true
                                        }
                                    },
                                    {
                                        $project: {
                                            user: {
                                                password: 0,
                                                email: 0,
                                                date_of_birth: 0
                                            }
                                        }
                                    }
                                ]
                            }
                        },
                        {
                            $addFields: {
                                parent_twizz: { $arrayElemAt: ['$parent_twizz', 0] }
                            }
                        },
                        {
                            $project: {
                                user: {
                                    password: 0,
                                    email_verify_token: 0,
                                    email: 0,
                                    date_of_birth: 0
                                }
                            }
                        }
                    ]
                }
            },
            {
                $addFields: {
                    'report.twizz.parent_twizz': { $arrayElemAt: ['$report.twizz.parent_twizz', 0] }
                }
            },
            {
                $project: {
                    'twizz.twizz_children': 0,
                    'twizz.user_likes': 0,
                    'twizz.user_bookmarks': 0,
                    'twizz.user.password': 0,
                    'twizz.user.email_verify_token': 0,
                    'twizz.user.email_verify_otp': 0,
                    'twizz.user.email_verify_otp_expires_at': 0,
                    'twizz.user.forgot_password_token': 0,
                    'twizz.user.forgot_password_otp': 0,
                    'twizz.user.forgot_password_otp_expires_at:': 0,
                    'twizz.user.date_of_birth': 0,
                    'report_id_obj': 0,
                    'report.twizz_snapshot': 0,
                    'report.twizz.user.password': 0,
                    'report.reporter.password': 0
                }
            }
        )

        return databaseService.notifications.aggregate(pipeline).toArray()
    }
    /**
     * Tạo nội dung body cho FCM notification dựa theo loại
     */
    private getFcmBody(type: NotificationType): string {
        switch (type) {
            case NotificationType.Like:
                return 'đã thích bài viết của bạn'
            case NotificationType.Comment:
                return 'đã bình luận bài viết của bạn'
            case NotificationType.QuoteTwizz:
                return 'đã trích dẫn bài viết của bạn'
            case NotificationType.Follow:
                return 'đã bắt đầu theo dõi bạn'
            case NotificationType.Mention:
                return 'đã nhắc đến bạn trong một bài viết'
            case NotificationType.ReportResolved:
                return 'Báo cáo của bạn đã được xử lý'
            case NotificationType.ReportIgnored:
                return 'Báo cáo của bạn đã được xem xét'
            case NotificationType.PostDeleted:
                return 'Bài viết của bạn đã bị gỡ bỏ'
            case NotificationType.AccountBanned:
                return 'Tài khoản của bạn đã bị khóa'
            default:
                return 'Bạn có thông báo mới'
        }
    }
}

const notificationsService = new NotificationsService()
export default notificationsService
