import { ObjectId } from 'mongodb'
import { NotificationType } from '~/constants/enum'

interface NotificationConstructor {
    _id?: ObjectId
    user_id: ObjectId // Recipient
    sender_id: ObjectId // Trigger user
    type: NotificationType
    twizz_id?: ObjectId // Optional, for Like/Comment/Quote
    is_read?: boolean
    created_at?: Date
}

export default class Notification {
    _id?: ObjectId
    user_id: ObjectId
    sender_id: ObjectId
    type: NotificationType
    twizz_id?: ObjectId
    is_read: boolean
    created_at: Date

    constructor({ _id, user_id, sender_id, type, twizz_id, is_read, created_at }: NotificationConstructor) {
        this._id = _id
        this.user_id = user_id
        this.sender_id = sender_id
        this.type = type
        this.twizz_id = twizz_id
        this.is_read = is_read || false
        this.created_at = created_at || new Date()
    }
}
