import { ObjectId } from 'mongodb'
import databaseService from './database.services'
import { UserVerifyStatus } from '~/constants/enum'

class AdminService {
    // Dashboard Statistics
    async getStats() {
        const [
            totalUsers,
            verifiedUsers,
            unverifiedUsers,
            bannedUsers,
            totalTwizzs,
            totalLikes,
            totalBookmarks
        ] = await Promise.all([
            databaseService.users.countDocuments(),
            databaseService.users.countDocuments({ verify: UserVerifyStatus.Verified }),
            databaseService.users.countDocuments({ verify: UserVerifyStatus.Unverified }),
            databaseService.users.countDocuments({ verify: UserVerifyStatus.Banned }),
            databaseService.twizzs.countDocuments(),
            databaseService.likes.countDocuments(),
            databaseService.bookmarks.countDocuments()
        ])

        // Get today's new users
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const newUsersToday = await databaseService.users.countDocuments({
            created_at: { $gte: today }
        })

        // Get new twizzs today
        const newTwizzsToday = await databaseService.twizzs.countDocuments({
            created_at: { $gte: today }
        })

        return {
            users: {
                total: totalUsers,
                verified: verifiedUsers,
                unverified: unverifiedUsers,
                banned: bannedUsers,
                new_today: newUsersToday
            },
            twizzs: {
                total: totalTwizzs,
                new_today: newTwizzsToday
            },
            engagement: {
                total_likes: totalLikes,
                total_bookmarks: totalBookmarks
            }
        }
    }

    // Get growth data for charts
    async getGrowthData(days: number = 7, offset: number = 0) {
        const result = []
        const now = new Date()
        now.setDate(now.getDate() - offset)

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now)
            date.setDate(date.getDate() - i)
            date.setHours(0, 0, 0, 0)

            const nextDate = new Date(date)
            nextDate.setDate(nextDate.getDate() + 1)

            const [usersCount, twizzsCount] = await Promise.all([
                databaseService.users.countDocuments({
                    created_at: { $gte: date, $lt: nextDate }
                }),
                databaseService.twizzs.countDocuments({
                    created_at: { $gte: date, $lt: nextDate }
                })
            ])

            result.push({
                date: date.toISOString().split('T')[0],
                users: usersCount,
                twizzs: twizzsCount
            })
        }

        return result
    }

    // Users Management
    async getUsers({
        page = 1,
        limit = 10,
        search = '',
        verify_status
    }: {
        page?: number
        limit?: number
        search?: string
        verify_status?: number
    }) {
        const filter: any = {}

        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ]
        }

        if (verify_status !== undefined) {
            filter.verify = verify_status
        }

        const [users, total] = await Promise.all([
            databaseService.users
                .find(filter, {
                    projection: {
                        password: 0,
                        email_verify_token: 0,
                        forgot_password_token: 0,
                        email_verify_otp: 0,
                        forgot_password_otp: 0
                    }
                })
                .sort({ created_at: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .toArray(),
            databaseService.users.countDocuments(filter)
        ])

        return {
            users,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }
    }

    // Get user detail with stats
    async getUserDetail(user_id: string) {
        const user = await databaseService.users.findOne(
            { _id: new ObjectId(user_id) },
            {
                projection: {
                    password: 0,
                    email_verify_token: 0,
                    forgot_password_token: 0,
                    email_verify_otp: 0,
                    forgot_password_otp: 0
                }
            }
        )

        if (!user) {
            return null
        }

        const [twizzsCount, followersCount, followingCount] = await Promise.all([
            databaseService.twizzs.countDocuments({ user_id: new ObjectId(user_id) }),
            databaseService.followers.countDocuments({ followed_user_id: new ObjectId(user_id) }),
            databaseService.followers.countDocuments({ user_id: new ObjectId(user_id) })
        ])

        return {
            ...user,
            stats: {
                twizzs: twizzsCount,
                followers: followersCount,
                following: followingCount
            }
        }
    }

    // Update user verify status
    async updateUserStatus(user_id: string, verify: UserVerifyStatus) {
        const updateData: any = {
            verify,
            updated_at: new Date()
        }

        // Reset violation count if unbanning (not setting to banned)
        if (verify !== UserVerifyStatus.Banned) {
            updateData.violation_count = 0
        }

        const result = await databaseService.users.updateOne(
            { _id: new ObjectId(user_id) },
            { $set: updateData }
        )
        return result.modifiedCount > 0
    }

    // Delete user
    async deleteUser(user_id: string) {
        const objectId = new ObjectId(user_id)

        // Delete user's twizzs, likes, bookmarks, followers, following
        await Promise.all([
            databaseService.users.deleteOne({ _id: objectId }),
            databaseService.twizzs.deleteMany({ user_id: objectId }),
            databaseService.likes.deleteMany({ user_id: objectId }),
            databaseService.bookmarks.deleteMany({ user_id: objectId }),
            databaseService.followers.deleteMany({
                $or: [{ user_id: objectId }, { followed_user_id: objectId }]
            }),
            databaseService.refreshTokens.deleteMany({ user_id: objectId }),
            databaseService.notifications.deleteMany({
                $or: [{ user_id: objectId }, { sender_id: objectId }]
            })
        ])

        return true
    }

    // Twizzs Management
    async getTwizzs({
        page = 1,
        limit = 10,
        search = '',
        type
    }: {
        page?: number
        limit?: number
        search?: string
        type?: number
    }) {
        const pipeline: any[] = []

        // Match stage
        const matchStage: any = {}
        if (search) {
            matchStage.content = { $regex: search, $options: 'i' }
        }
        if (type !== undefined) {
            matchStage.type = type
        }
        if (Object.keys(matchStage).length > 0) {
            pipeline.push({ $match: matchStage })
        }

        // Sort by created_at
        pipeline.push({ $sort: { created_at: -1 } })

        // Lookup user info
        pipeline.push({
            $lookup: {
                from: process.env.DB_USERS_COLLECTION,
                localField: 'user_id',
                foreignField: '_id',
                as: 'user',
                pipeline: [
                    {
                        $project: {
                            _id: 1,
                            name: 1,
                            username: 1,
                            avatar: 1
                        }
                    }
                ]
            }
        })
        pipeline.push({ $unwind: { path: '$user', preserveNullAndEmptyArrays: true } })

        // Count total
        const countPipeline = [...pipeline, { $count: 'total' }]
        const countResult = await databaseService.twizzs.aggregate(countPipeline).toArray()
        const total = countResult[0]?.total || 0

        // Pagination
        pipeline.push({ $skip: (page - 1) * limit })
        pipeline.push({ $limit: limit })

        const twizzs = await databaseService.twizzs.aggregate(pipeline).toArray()

        return {
            twizzs,
            pagination: {
                page,
                limit,
                total,
                total_pages: Math.ceil(total / limit)
            }
        }
    }

    // Delete twizz
    async deleteTwizz(twizz_id: string) {
        const objectId = new ObjectId(twizz_id)

        // Find all descendant IDs recursively
        const allIdsToDelete: ObjectId[] = [objectId]
        const queue: ObjectId[] = [objectId]

        while (queue.length > 0) {
            const currentParentId = queue.shift() as ObjectId
            const children = await databaseService.twizzs
                .find({ parent_id: currentParentId })
                .project({ _id: 1 })
                .toArray()

            if (children.length > 0) {
                const childIds = children.map((child) => child._id)
                allIdsToDelete.push(...childIds)
                queue.push(...childIds)
            }
        }

        // Delete twizzs and related data
        await Promise.all([
            databaseService.twizzs.deleteMany({ _id: { $in: allIdsToDelete } }),
            databaseService.likes.deleteMany({ twizz_id: { $in: allIdsToDelete } }),
            databaseService.bookmarks.deleteMany({ twizz_id: { $in: allIdsToDelete } })
        ])

        return true
    }
}

const adminService = new AdminService()
export default adminService
