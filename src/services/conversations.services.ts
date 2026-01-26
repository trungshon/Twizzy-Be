import { ObjectId } from 'mongodb'
import databaseService from './database.services'

class ConversationsService {
    async getConversations({ sender_id, receiver_id, limit, page }: { sender_id: string, receiver_id: string, limit: number, page: number }) {
        const match = {
            $or: [
                {
                    sender_id: new ObjectId(sender_id),
                    receiver_id: new ObjectId(receiver_id)
                },
                {
                    sender_id: new ObjectId(receiver_id),
                    receiver_id: new ObjectId(sender_id)
                }
            ]
        }
        const conversations = await databaseService.conversations.find(match).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray()
        const total = await databaseService.conversations.countDocuments(match)
        return { conversations, total }
    }

    async acceptConversation({ user_id, sender_id }: { user_id: string, sender_id: string }) {
        await databaseService.conversations.updateMany(
            {
                $or: [
                    { sender_id: new ObjectId(sender_id), receiver_id: new ObjectId(user_id) },
                    { sender_id: new ObjectId(user_id), receiver_id: new ObjectId(sender_id) }
                ]
            },
            {
                $set: { is_accepted: true }
            }
        )
    }

    async deleteConversation({ user_id, sender_id }: { user_id: string, sender_id: string }) {
        await databaseService.conversations.deleteMany({
            $or: [
                { sender_id: new ObjectId(sender_id), receiver_id: new ObjectId(user_id) },
                { sender_id: new ObjectId(user_id), receiver_id: new ObjectId(sender_id) }
            ]
        })
    }

    async getConversationsList(user_id: string) {
        const userId = new ObjectId(user_id)
        const result = await databaseService.conversations.aggregate([
            {
                $match: {
                    $or: [
                        { sender_id: userId },
                        { receiver_id: userId }
                    ]
                }
            },
            {
                $sort: { created_at: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ["$sender_id", userId] },
                            "$receiver_id",
                            "$sender_id"
                        ]
                    },
                    latest_message: { $first: "$$ROOT" }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $project: {
                    _id: 0,
                    other_user: {
                        _id: '$user._id',
                        name: '$user.name',
                        username: '$user.username',
                        avatar: '$user.avatar'
                    },
                    latest_message: 1
                }
            },
            {
                $sort: { 'latest_message.created_at': -1 }
            }
        ]).toArray()

        return result
    }
}
const conversationsService = new ConversationsService()
export default conversationsService