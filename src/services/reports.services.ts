import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import Report from '~/models/schemas/Report.schema'
import { ReportStatus, UserVerifyStatus } from '~/constants/enum'

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
        const report = new Report({
            user_id: new ObjectId(user_id),
            twizz_id: new ObjectId(twizz_id),
            reason,
            description
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
                        $lookup: {
                            from: 'users',
                            localField: 'twizz.user_id',
                            foreignField: '_id',
                            as: 'twizz.user'
                        }
                    },
                    { $unwind: { path: '$twizz.user', preserveNullAndEmptyArrays: true } },
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
            await databaseService.twizzs.deleteOne({ _id: report.twizz_id })
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                { $set: { status: ReportStatus.Resolved, updated_at: new Date() } }
            )
        } else if (action === 'ban') {
            const twizz = await databaseService.twizzs.findOne({ _id: report.twizz_id })
            if (twizz) {
                await databaseService.users.updateOne(
                    { _id: twizz.user_id },
                    { $set: { verify: UserVerifyStatus.Banned, updated_at: new Date() } }
                )
            }
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                { $set: { status: ReportStatus.Resolved, updated_at: new Date() } }
            )
        } else if (action === 'ignore') {
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                { $set: { status: ReportStatus.Ignored, updated_at: new Date() } }
            )
        } else if (action === 'warn') {
            // Warn logic - for now just marking as resolved
            await databaseService.reports.updateOne(
                { _id: new ObjectId(report_id) },
                { $set: { status: ReportStatus.Resolved, updated_at: new Date() } }
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
