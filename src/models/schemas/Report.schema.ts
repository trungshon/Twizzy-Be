import { ObjectId } from 'mongodb'
import { ReportReason, ReportStatus } from '~/constants/enum'

interface ReportConstructor {
    _id?: ObjectId
    user_id: ObjectId
    twizz_id: ObjectId
    reason: ReportReason
    description?: string
    status?: ReportStatus
    created_at?: Date
    updated_at?: Date
}

export default class Report {
    _id?: ObjectId
    user_id: ObjectId
    twizz_id: ObjectId
    reason: ReportReason
    description: string
    status: ReportStatus
    created_at: Date
    updated_at: Date

    constructor({
        _id,
        user_id,
        twizz_id,
        reason,
        description,
        status,
        created_at,
        updated_at
    }: ReportConstructor) {
        const date = new Date()
        this._id = _id
        this.user_id = user_id
        this.twizz_id = twizz_id
        this.reason = reason
        this.description = description || ''
        this.status = status || ReportStatus.Pending
        this.created_at = created_at || date
        this.updated_at = updated_at || date
    }
}
