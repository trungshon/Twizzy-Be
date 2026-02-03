import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import Report from '~/models/schemas/Report.schema'
import { ReportStatus, UserVerifyStatus, NotificationType } from '~/constants/enum'
import adminService from './admin.services'
import notificationsService from './notifications.services'

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
        // Create snapshot of the twizz
        const twizz = await databaseService.twizzs.findOne({ _id: new ObjectId(twizz_id) })
        let twizz_snapshot = null
        if (twizz) {
            const user = await databaseService.users.findOne({ _id: twizz.user_id })
            twizz_snapshot = {
                ...twizz,
                user
            }
        }

        const report = new Report({
            user_id: new ObjectId(user_id),
            twizz_id: new ObjectId(twizz_id),
            reason,
            description,
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
                            localField: 'user_id',
                            foreignField: '_id',
                            as: 'reporter'
                        }
                    },
                    { $unwind: { path: '$reporter', preserveNullAndEmptyArrays: true } }
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
                        violation_count: updatedUser?.violation_count || 0
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
                        type: NotificationType.AccountBanned
                    })
                }
            }

            // Send notification to reporter
            await notificationsService.createNotification({
                user_id: report.user_id.toString(),
                sender_id: admin_id,
                type: NotificationType.ReportResolved
            })

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
        } else if (action === 'ban') {
            const twizz_user_id = (report as any).twizz_snapshot?.user_id || (await databaseService.twizzs.findOne({ _id: report.twizz_id }))?.user_id

            if (twizz_user_id) {
                // Delete the offending post when banning user
                await adminService.deleteTwizz(report.twizz_id.toString())

                await databaseService.users.updateOne(
                    { _id: new ObjectId(twizz_user_id) },
                    {
                        $set: {
                            verify: UserVerifyStatus.Banned,
                            violation_count: 3,
                            updated_at: new Date()
                        }
                    }
                )

                // Send notifications
                await Promise.all([
                    notificationsService.createNotification({
                        user_id: twizz_user_id.toString(),
                        sender_id: admin_id,
                        type: NotificationType.AccountBanned
                    }),
                    notificationsService.createNotification({
                        user_id: report.user_id.toString(),
                        sender_id: admin_id,
                        type: NotificationType.ReportResolved
                    })
                ])
            }
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
        } else if (action === 'ignore') {
            // Send notification to reporter
            await notificationsService.createNotification({
                user_id: report.user_id.toString(),
                sender_id: admin_id,
                type: NotificationType.ReportIgnored
            })

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
        }
        return true
    }

    async deleteReport(report_id: string) {
        await databaseService.reports.deleteOne({ _id: new ObjectId(report_id) })
        return true
    }
}

const reportsService = new ReportsService()
export default reportsService
