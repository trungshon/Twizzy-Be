import { ObjectId } from "mongodb";

interface MediaType {
    url: string
    type: number // 0 = Image, 1 = Video
}

interface ConversationType {
    _id?: ObjectId
    sender_id: ObjectId
    receiver_id: ObjectId
    content: string
    medias?: MediaType[]
    is_accepted?: boolean
    is_read?: boolean
    deleted_by?: ObjectId[]
    created_at?: Date
    updated_at?: Date
}

export default class Conversation {
    _id?: ObjectId
    sender_id: ObjectId
    receiver_id: ObjectId
    content: string
    medias: MediaType[]
    is_accepted: boolean
    is_read: boolean
    deleted_by: ObjectId[]
    created_at: Date
    updated_at: Date
    constructor({ _id, sender_id, receiver_id, content, medias, is_accepted, is_read, deleted_by, created_at, updated_at }: ConversationType) {
        const date = new Date()
        this._id = _id
        this.sender_id = sender_id
        this.receiver_id = receiver_id
        this.content = content
        this.medias = medias || []
        this.is_accepted = is_accepted ?? false
        this.is_read = is_read ?? false
        this.deleted_by = deleted_by || []
        this.created_at = created_at || date
        this.updated_at = updated_at || date
    }
}
