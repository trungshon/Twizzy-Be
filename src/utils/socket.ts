import { Server as ServerHttp } from "http"
import { ObjectId } from "mongodb"
import { UserVerifyStatus } from "~/constants/enum"
import { HTTP_STATUS } from "~/constants/httpStatus"
import { USER_MESSAGES } from "~/constants/messages"
import { ErrorWithStatus } from "~/models/Errors"
import { TokenPayload } from "~/models/requests/User.requests"
import Conversation from "~/models/schemas/Conversations.schema"
import databaseService from "~/services/database.services"
import { verifyAccessToken } from "./commons"
import { Server } from "socket.io"

const initSocket = (httpServer: ServerHttp) => {
    const io = new Server(httpServer, {
        cors: {
            origin: 'http://localhost:3000'
        },
    })

    const users: {
        [key: string]: { socket_id: string }
    } = {}

    io.use(async (socket, next) => {
        const { Authorization } = socket.handshake.auth
        const accessToken = Authorization?.split(' ')[1]
        try {
            const decoded_authorization = await verifyAccessToken(accessToken)
            const { verify } = decoded_authorization as TokenPayload
            if (verify !== UserVerifyStatus.Verified) {
                throw new ErrorWithStatus({
                    message: USER_MESSAGES.USER_NOT_VERIFIED,
                    status: HTTP_STATUS.FORBIDDEN
                })
            }
            socket.handshake.auth.decoded_authorization = decoded_authorization
            socket.handshake.auth.access_token = accessToken
            next()
        } catch (error) {
            return next({ message: 'Unauthorized', name: 'UnauthorizedError', data: error })
        }
    })

    io.on('connection', (socket) => {
        const { user_id } = socket.handshake.auth.decoded_authorization as TokenPayload
        console.log(`user ${user_id} connected (socket: ${socket.id})`)

        users[user_id] = { socket_id: socket.id }
        console.log(users)
        socket.use(async (packet, next) => {
            const { access_token } = socket.handshake.auth
            try {
                await verifyAccessToken(access_token)
                next()
            } catch (error) {
                next(new Error('Unauthorized'))
            }
        })

        socket.on('error', (error) => {
            if (error.message === 'Unauthorized') {
                socket.disconnect()
            }
        })
        socket.on('send_message', async (data) => {
            const { receiver_id, sender_id, content } = data.payload
            const receiver_socket_id = users[receiver_id]?.socket_id

            // Check if receiver follows sender
            const isFollower = await databaseService.followers.findOne({
                user_id: new ObjectId(receiver_id),
                followed_user_id: new ObjectId(sender_id)
            })

            let is_accepted = false

            if (isFollower) {
                is_accepted = true
            } else {
                // Check if there was any previously accepted message in this conversation
                const lastAcceptedConversation = await databaseService.conversations.findOne({
                    $or: [
                        { sender_id: new ObjectId(sender_id), receiver_id: new ObjectId(receiver_id), is_accepted: true },
                        { sender_id: new ObjectId(receiver_id), receiver_id: new ObjectId(sender_id), is_accepted: true }
                    ]
                })
                if (lastAcceptedConversation) {
                    is_accepted = true
                }
            }

            const conversation = new Conversation({
                sender_id: new ObjectId(sender_id),
                receiver_id: new ObjectId(receiver_id),
                content: content,
                is_accepted: is_accepted
            })
            const result = await databaseService.conversations.insertOne(conversation)
            conversation._id = result.insertedId
            if (receiver_socket_id) {
                socket.to(receiver_socket_id).emit('receive_message', {
                    payload: conversation,
                })
            }
            // Also emit back to the sender for confirmation/UI update
            socket.emit('receive_message', {
                payload: conversation,
            })
        })
        socket.on('disconnect', () => {
            delete users[user_id]
            console.log(`user ${user_id} disconnected`)
        })
    })
}

export default initSocket
