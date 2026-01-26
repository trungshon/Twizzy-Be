import { Request, Response } from 'express'
import conversationsService from '~/services/conversations.services'
import { TokenPayload } from '~/models/requests/User.requests'
import { CONVERSATION_MESSAGES } from '~/constants/messages'
import { GetConversationsParams } from '~/models/requests/Conversation.requests'

export const getConversationsController = async (req: Request<GetConversationsParams>, res: Response) => {
    const limit = Number(req.query.limit)
    const page = Number(req.query.page)
    const { receiver_id } = req.params
    const sender_id = req.decoded_authorization?.user_id as string
    const result = await conversationsService.getConversations({ sender_id, receiver_id, limit, page })
    return res.json({
        result: {
            limit,
            page,
            total_page: Math.ceil(result.total / limit),
            conversations: result.conversations
        },
        message: CONVERSATION_MESSAGES.GET_CONVERSATION_SUCCESSFULLY,
    })
}

export const getConversationsListController = async (req: Request, res: Response) => {
    const user_id = req.decoded_authorization?.user_id as string
    const result = await conversationsService.getConversationsList(user_id)
    return res.json({
        result,
        message: 'Get conversations list successfully'
    })
}

export const acceptConversationController = async (req: Request, res: Response) => {
    const user_id = req.decoded_authorization?.user_id as string
    const { sender_id } = req.params
    await conversationsService.acceptConversation({ user_id, sender_id })
    return res.json({
        message: 'Accept conversation successfully'
    })
}

export const deleteConversationController = async (req: Request, res: Response) => {
    const user_id = req.decoded_authorization?.user_id as string
    const { sender_id } = req.params
    await conversationsService.deleteConversation({ user_id, sender_id })
    return res.json({
        message: 'Delete conversation successfully'
    })
}