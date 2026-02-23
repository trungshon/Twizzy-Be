import { ObjectId } from 'mongodb'
import { ReportReason, ReportStatus } from '~/constants/enum'

interface ReportConstructor {
    _id?: ObjectId
    user_ids: ObjectId[]
    twizz_id: ObjectId
    reasons: ReportReason[]
    descriptions?: string[]
    status?: ReportStatus
    action?: string
    admin_id?: ObjectId
    twizz_snapshot?: any
    created_at?: Date
    updated_at?: Date
}

export default class Report {
    _id?: ObjectId
    user_ids: ObjectId[]
    twizz_id: ObjectId
    reasons: ReportReason[]
    descriptions: string[]
    status: ReportStatus
    action?: string
    admin_id?: ObjectId
    twizz_snapshot?: any
    created_at: Date
    updated_at: Date

    constructor({
        _id,
        user_ids,
        twizz_id,
        reasons,
        descriptions,
        status,
        action,
        admin_id,
        twizz_snapshot,
        created_at,
        updated_at
    }: ReportConstructor) {
        const date = new Date()
        this._id = _id
        this.user_ids = user_ids
        this.twizz_id = twizz_id
        this.reasons = reasons
        this.descriptions = descriptions || []
        this.status = status || ReportStatus.Pending
        this.action = action
        this.admin_id = admin_id
        this.twizz_snapshot = twizz_snapshot
        this.created_at = created_at || date
        this.updated_at = updated_at || date
    }
}
