import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import Report from '~/models/schemas/Report.schema'
import { ReportStatus, UserVerifyStatus, NotificationType } from '~/constants/enum'
import adminService from './admin.services'
import notificationsService from './notifications.services'
import { io, users } from '~/utils/socket'
import { ErrorWithStatus } from '~/models/Errors'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { REPORT_MESSAGES } from '~/constants/messages'

const REPORTING_THRESHOLD = 3

class ReportsService {
    async createReport({
        user_id,
        twizz_id,
        reason,
        description
    }: {
        user_id: string
        twizz_id: string
        reason: number
        description: string
    }) {
        const existingReport = await databaseService.reports.findOne({
            twizz_id: new ObjectId(twizz_id),
            status: ReportStatus.Pending
        })

        if (existingReport) {
            // Check if user has already reported
            const hasReported = existingReport.user_ids.some((id) => id.toString() === user_id)
            if (hasReported) {
                throw new ErrorWithStatus({
                    message: REPORT_MESSAGES.ALREADY_REPORTED,
                    status: HTTP_STATUS.FORBIDDEN
                })
            }
            const updateQuery: any = {
                $addToSet: {
                    user_ids: new ObjectId(user_id),
                    reasons: reason
                },
                $set: { updated_at: new Date() }
            }

            if (description && description.trim() !== '') {
                updateQuery.$addToSet.descriptions = description
            }

            await databaseService.reports.updateOne({ _id: existingReport._id }, updateQuery)
            return existingReport
        }

        // Create snapshot of the twizz
        const twizz = await databaseService.twizzs.findOne({ _id: new ObjectId(twizz_id) })
        let twizz_snapshot = null
        if (twizz) {
            const user = await databaseService.users.findOne({ _id: twizz.user_id })
            let parent_twizz = null
            if (twizz.parent_id) {
                const parent = await databaseService.twizzs.findOne({ _id: twizz.parent_id })
                if (parent) {
                    const parent_user = await databaseService.users.findOne({ _id: parent.user_id })

                    // Grandparent level
                    let grandparent_twizz = null
                    if (parent.parent_id) {
                        const grandparent = await databaseService.twizzs.findOne({ _id: parent.parent_id })
                        if (grandparent) {
                            const grandparent_user = await databaseService.users.findOne({ _id: grandparent.user_id })

                            // Great-grandparent level
                            let great_grandparent_twizz = null
                            if (grandparent.parent_id) {
                                const great_grandparent = await databaseService.twizzs.findOne({ _id: grandparent.parent_id })
                                if (great_grandparent) {
                                    const great_grandparent_user = await databaseService.users.findOne({ _id: great_grandparent.user_id })
                                    great_grandparent_twizz = {
                                        ...great_grandparent,
                                        user: great_grandparent_user
                                    }
                                }
                            }

                            grandparent_twizz = {
                                ...grandparent,
                                user: grandparent_user,
                                parent_twizz: great_grandparent_twizz
                            }
                        }
                    }

                    parent_twizz = {
                        ...parent,
                        user: parent_user,
                        parent_twizz: grandparent_twizz
                    }
                }
            }
            twizz_snapshot = {
                ...twizz,
                user,
                parent_twizz
            }
        }

        const report = new Report({
            user_ids: [new ObjectId(user_id)],
            twizz_id: new ObjectId(twizz_id),
            reasons: [reason],
            descriptions: description && description.trim() !== '' ? [description] : [],
            twizz_snapshot
        })
        await databaseService.reports.insertOne(report)
        return report
    }

    async getReports({
        page = 1,
        limit = 10,
        status
    }: {
        page?: number
        limit?: number
        status?: number
    }) {
        const filter: any = {}
        if (status !== undefined) {
            filter.status = status
        }

        // Only show to admin if threshold reached or if it's already processed
        if (status === ReportStatus.Pending || status === undefined) {
            filter.$or = [
                { $expr: { $gte: [{ $size: '$user_ids' }, REPORTING_THRESHOLD] } },
                { status: { $ne: ReportStatus.Pending } }
            ]
        }

        const [reports, total] = await Promise.all([
            databaseService.reports
                .aggregate([
                    { $match: filter },
                    { $sort: { created_at: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz_id',
                            foreignField: '_id',
                            as: 'twizz'
                        }
                    },
                    { $unwind: { path: '$twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            // Fallback to snapshot if live post is gone
                            twizz: { $ifNull: ['$twizz', '$twizz_snapshot'] }
                        }
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'twizz.user_id',
                            foreignField: '_id',
                            as: 'twizz_user'
                        }
                    },
                    { $unwind: { path: '$twizz_user', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            // Use live user if found, otherwise keep snapshot user
                            'twizz.user': {
                                $mergeObjects: [
                                    { $ifNull: ['$twizz.user', '$twizz_user'] },
                                    { violation_count: { $ifNull: ['$twizz_user.violation_count', 0] } }
                                ]
                            }
                        }
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'user_ids',
                            foreignField: '_id',
                            as: 'reporters'
                        }
                    },
                    {
                        $addFields: {
                            reporter: { $arrayElemAt: ['$reporters', 0] }
                        }
                    },
                    // Lookup parent_twizz for nested twizz
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz.parent_id',
                            foreignField: '_id',
                            as: 'parent_twizz'
                        }
                    },
                    { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'parent_twizz.user_id',
                            foreignField: '_id',
                            as: 'parent_user'
                        }
                    },
                    { $unwind: { path: '$parent_user', preserveNullAndEmptyArrays: true } },
                    // Lookup grandparent_twizz (parent of parent) for nested quotes
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'parent_twizz.parent_id',
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
                                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
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
                                            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                                            {
                                                $project: {
                                                    user: {
                                                        password: 0,
                                                        email_verify_token: 0,
                                                        twizz_circle: 0,
                                                        email_verify_otp: 0,
                                                        email_verify_otp_expires_at: 0,
                                                        forgot_password_token: 0,
                                                        forgot_password_otp: 0,
                                                        forgot_password_otp_expires_at: 0,
                                                        date_of_birth: 0
                                                    }
                                                }
                                            }
                                        ],
                                        as: 'parent_twizz'
                                    }
                                },
                                { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                                {
                                    $project: {
                                        user: {
                                            password: 0,
                                            email_verify_token: 0,
                                            twizz_circle: 0,
                                            email_verify_otp: 0,
                                            email_verify_otp_expires_at: 0,
                                            forgot_password_token: 0,
                                            forgot_password_otp: 0,
                                            forgot_password_otp_expires_at: 0,
                                            date_of_birth: 0
                                        }
                                    }
                                }
                            ],
                            as: 'grandparent_twizz'
                        }
                    },
                    { $unwind: { path: '$grandparent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            parent_twizz: 0,
                            parent_user: 0,
                            grandparent_twizz: 0,
                            grandparent_user: 0
                        }
                    }
                ])
                .toArray(),
            databaseService.reports.countDocuments(filter)
        ])

        return {
            reports,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }
    }

    async getMyReports({
        user_id,
        page = 1,
        limit = 10
    }: {
        user_id: string
        page?: number
        limit?: number
    }) {
        const filter = { user_ids: new ObjectId(user_id) }

        const [reports, total] = await Promise.all([
            databaseService.reports
                .aggregate([
                    { $match: filter },
                    { $sort: { created_at: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz_id',
                            foreignField: '_id',
                            as: 'twizz'
                        }
                    },
                    { $unwind: { path: '$twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            twizz: { $ifNull: ['$twizz', '$twizz_snapshot'] }
                        }
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'twizz.user_id',
                            foreignField: '_id',
                            as: 'twizz_user'
                        }
                    },
                    { $unwind: { path: '$twizz_user', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            'twizz.user': { $ifNull: ['$twizz_user', '$twizz.user'] }
                        }
                    },
                    // Lookup parent_twizz for nested twizz
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz.parent_id',
                            foreignField: '_id',
                            as: 'parent_twizz'
                        }
                    },
                    { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'parent_twizz.user_id',
                            foreignField: '_id',
                            as: 'parent_user'
                        }
                    },
                    { $unwind: { path: '$parent_user', preserveNullAndEmptyArrays: true } },
                    // Lookup grandparent_twizz (parent of parent) for nested quotes
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'parent_twizz.parent_id',
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
                                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
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
                                            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                                            {
                                                $project: {
                                                    user: {
                                                        password: 0,
                                                        email_verify_token: 0,
                                                        twizz_circle: 0,
                                                        email_verify_otp: 0,
                                                        email_verify_otp_expires_at: 0,
                                                        forgot_password_token: 0,
                                                        forgot_password_otp: 0,
                                                        forgot_password_otp_expires_at: 0,
                                                        date_of_birth: 0
                                                    }
                                                }
                                            }
                                        ],
                                        as: 'parent_twizz'
                                    }
                                },
                                { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                                {
                                    $project: {
                                        user: {
                                            password: 0,
                                            email_verify_token: 0,
                                            twizz_circle: 0,
                                            email_verify_otp: 0,
                                            email_verify_otp_expires_at: 0,
                                            forgot_password_token: 0,
                                            forgot_password_otp: 0,
                                            forgot_password_otp_expires_at: 0,
                                            date_of_birth: 0
                                        }
                                    }
                                }
                            ],
                            as: 'grandparent_twizz'
                        }
                    },
                    { $unwind: { path: '$grandparent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            twizz_user: 0,
                            parent_twizz: 0,
                            parent_user: 0,
                            grandparent_twizz: 0,
                            grandparent_user: 0,
                            user_ids: 0,
                            reporters: 0
                        }
                    }
                ])
                .toArray(),
            databaseService.reports.countDocuments(filter)
        ])

        return {
            reports,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }
    }

    async getReportsAgainstMe({
        user_id,
        page = 1,
        limit = 10
    }: {
        user_id: string
        page?: number
        limit?: number
    }) {
        // Filter by twizz_snapshot.user_id - this works even if twizz is deleted
        // because the snapshot contains the original user_id
        const filter = { 'twizz_snapshot.user_id': new ObjectId(user_id) }

        const [reports, total] = await Promise.all([
            databaseService.reports
                .aggregate([
                    { $match: filter },
                    { $sort: { created_at: -1 } },
                    { $skip: (page - 1) * limit },
                    { $limit: limit },
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz_id',
                            foreignField: '_id',
                            as: 'twizz'
                        }
                    },
                    { $unwind: { path: '$twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            twizz: { $ifNull: ['$twizz', '$twizz_snapshot'] }
                        }
                    },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'twizz.user_id',
                            foreignField: '_id',
                            as: 'twizz_user'
                        }
                    },
                    { $unwind: { path: '$twizz_user', preserveNullAndEmptyArrays: true } },
                    {
                        $addFields: {
                            'twizz.user': { $ifNull: ['$twizz_user', '$twizz.user'] }
                        }
                    },

                    // Lookup parent_twizz for nested twizz
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'twizz.parent_id',
                            foreignField: '_id',
                            as: 'parent_twizz'
                        }
                    },
                    { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'parent_twizz.user_id',
                            foreignField: '_id',
                            as: 'parent_user'
                        }
                    },
                    { $unwind: { path: '$parent_user', preserveNullAndEmptyArrays: true } },
                    // Lookup grandparent_twizz (parent of parent) for nested quotes
                    {
                        $lookup: {
                            from: 'twizzs',
                            localField: 'parent_twizz.parent_id',
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
                                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
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
                                            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                                            {
                                                $project: {
                                                    user: {
                                                        password: 0,
                                                        email_verify_token: 0,
                                                        twizz_circle: 0,
                                                        email_verify_otp: 0,
                                                        email_verify_otp_expires_at: 0,
                                                        forgot_password_token: 0,
                                                        forgot_password_otp: 0,
                                                        forgot_password_otp_expires_at: 0,
                                                        date_of_birth: 0
                                                    }
                                                }
                                            }
                                        ],
                                        as: 'parent_twizz'
                                    }
                                },
                                { $unwind: { path: '$parent_twizz', preserveNullAndEmptyArrays: true } },
                                {
                                    $project: {
                                        user: {
                                            password: 0,
                                            email_verify_token: 0,
                                            twizz_circle: 0,
                                            email_verify_otp: 0,
                                            email_verify_otp_expires_at: 0,
                                            forgot_password_token: 0,
                                            forgot_password_otp: 0,
                                            forgot_password_otp_expires_at: 0,
                                            date_of_birth: 0
                                        }
                                    }
                                }
                            ],
                            as: 'grandparent_twizz'
                        }
                    },
                    { $unwind: { path: '$grandparent_twizz', preserveNullAndEmptyArrays: true } },
                    {
                        $project: {
                            twizz_user: 0,
                            parent_twizz: 0,
                            parent_user: 0,
                            grandparent_twizz: 0,
                            grandparent_user: 0,
                            user_ids: 0,
                            reporters: 0
                        }
                    }
                ])
                .toArray(),
            databaseService.reports.countDocuments(filter)
        ])

        return {
            reports,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }
    }

    async handleReport({
        report_id,
        action,
        admin_id
    }: {
        report_id: string
        action: 'delete' | 'ban' | 'ignore' | 'warn'
        admin_id: string
    }) {
        const report = await databaseService.reports.findOne({ _id: new ObjectId(report_id) })
        if (!report) throw new Error('Report not found')

        if (action === 'delete') {
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                {
                    $set: {
                        status: ReportStatus.Resolved,
                        action: 'delete',
                        admin_id: new ObjectId(admin_id),
                        updated_at: new Date()
                    }
                }
            )

            await adminService.deleteTwizz(report.twizz_id.toString())

            // Increment violation count
            const twizz_user_id = (report as any).twizz_snapshot?.user_id || (await databaseService.twizzs.findOne({ _id: report.twizz_id }))?.user_id

            if (twizz_user_id) {
                const updatedUser = await databaseService.users.findOneAndUpdate(
                    { _id: new ObjectId(twizz_user_id) },
                    {
                        $inc: { violation_count: 1 },
                        $set: { updated_at: new Date() }
                    },
                    { returnDocument: 'after' }
                )

                // Send notification to reported user
                await notificationsService.createNotification({
                    user_id: twizz_user_id.toString(),
                    sender_id: admin_id,
                    type: NotificationType.PostDeleted,
                    metadata: {
                        violation_count: updatedUser?.violation_count || 0,
                        report_id: report._id.toString()
                    }
                })

                // Auto ban if violation count >= 3
                if (updatedUser && (updatedUser.violation_count || 0) >= 3 && updatedUser.verify !== UserVerifyStatus.Banned) {
                    await databaseService.users.updateOne(
                        { _id: updatedUser._id },
                        { $set: { verify: UserVerifyStatus.Banned, updated_at: new Date() } }
                    )

                    // Send ban notification if auto-banned
                    await notificationsService.createNotification({
                        user_id: twizz_user_id.toString(),
                        sender_id: admin_id,
                        type: NotificationType.AccountBanned,
                        metadata: {
                            report_id: report._id.toString()
                        }
                    })

                    // Emit socket event for status change
                    const targetSocketId = users[twizz_user_id.toString()]?.socket_id
                    if (targetSocketId) {
                        io.to(targetSocketId).emit('user_status_changed', { verify: UserVerifyStatus.Banned })
                    }
                }
            }

            // Send notification to all reporters
            await Promise.all(
                report.user_ids.map((uid: ObjectId) =>
                    notificationsService.createNotification({
                        user_id: uid.toString(),
                        sender_id: admin_id,
                        type: NotificationType.ReportResolved,
                        metadata: {
                            report_id: report._id!.toString()
                        }
                    })
                )
            )
        } else if (action === 'ban') {
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                {
                    $set: {
                        status: ReportStatus.Resolved,
                        action: 'ban',
                        admin_id: new ObjectId(admin_id),
                        updated_at: new Date()
                    }
                }
            )

            const twizz_user_id = (report as any).twizz_snapshot?.user_id || (await databaseService.twizzs.findOne({ _id: report.twizz_id }))?.user_id

            if (twizz_user_id) {
                // Delete the offending post when banning user
                await adminService.deleteTwizz(report.twizz_id.toString())

                await databaseService.users.updateOne(
                    { _id: new ObjectId(twizz_user_id) },
                    {
                        $set: {
                            verify: UserVerifyStatus.Banned,
                            updated_at: new Date()
                        }
                    }
                )


                // Send notifications
                const reporterNotifications = report.user_ids.map((uid: ObjectId) =>
                    notificationsService.createNotification({
                        user_id: uid.toString(),
                        sender_id: admin_id,
                        type: NotificationType.ReportResolved,
                        metadata: {
                            report_id: report._id!.toString()
                        }
                    })
                )

                await Promise.all([
                    notificationsService.createNotification({
                        user_id: twizz_user_id.toString(),
                        sender_id: admin_id,
                        type: NotificationType.AccountBanned,
                        metadata: {
                            report_id: report._id!.toString()
                        }
                    }),
                    ...reporterNotifications
                ])

                // Emit socket event for status change
                const targetSocketId = users[twizz_user_id.toString()]?.socket_id
                if (targetSocketId) {
                    io.to(targetSocketId).emit('user_status_changed', { verify: UserVerifyStatus.Banned })
                }
            }
        } else if (action === 'ignore') {
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                {
                    $set: {
                        status: ReportStatus.Ignored,
                        action: 'ignore',
                        admin_id: new ObjectId(admin_id),
                        updated_at: new Date()
                    }
                }
            )

            // Send notification to all reporters
            await Promise.all(
                report.user_ids.map((uid: ObjectId) =>
                    notificationsService.createNotification({
                        user_id: uid.toString(),
                        sender_id: admin_id,
                        type: NotificationType.ReportIgnored,
                        metadata: {
                            report_id: report._id!.toString()
                        }
                    })
                )
            )

            // Emit socket events
            report.user_ids.forEach((uid: ObjectId) => {
                const reporterSocketId = users[uid.toString()]?.socket_id
                if (reporterSocketId) {
                    io.to(reporterSocketId).emit('user_status_changed', { verify: ReportStatus.Ignored })
                }
            })
        }
        return true
    }

    async deleteReport(report_id: string) {
        await databaseService.reports.deleteOne({ _id: new ObjectId(report_id) })
        return true
    }

    async deleteProcessedReports() {
        await databaseService.reports.deleteMany({
            status: { $in: [ReportStatus.Resolved, ReportStatus.Ignored] }
        })
        return true
    }
}

const reportsService = new ReportsService()
export default reportsService
