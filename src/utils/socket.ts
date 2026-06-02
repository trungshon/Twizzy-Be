import { Server as ServerHttp } from "http"
import { ObjectId } from "mongodb"
import { UserVerifyStatus, NotificationSetting } from "~/constants/enum"
import { HTTP_STATUS } from "~/constants/httpStatus"
import { USER_MESSAGES } from "~/constants/messages"
import { ErrorWithStatus } from "~/models/Errors"
import { TokenPayload } from "~/models/requests/User.requests"
import Conversation from "~/models/schemas/Conversations.schema"
import databaseService from "~/services/database.services"
import { verifyAccessToken } from "./commons"
import { Server } from "socket.io"
import firebaseService from "~/services/firebase.services"

export let io: Server
export const users: {
    [key: string]: { socket_id: string }
} = {}

const initSocket = (httpServer: ServerHttp) => {
    io = new Server(httpServer, {
        cors: {
            origin: 'http://localhost:3000'
        },
    })

    io.use(async (socket, next) => {
        const { Authorization } = socket.handshake.auth
        const accessToken = Authorization?.split(' ')[1]
        try {
            const decoded_authorization = await verifyAccessToken(accessToken)
            socket.handshake.auth.decoded_authorization = decoded_authorization
            socket.handshake.auth.access_token = accessToken
            next()
        } catch (error) {
            return next({ message: 'Unauthorized', name: 'UnauthorizedError', data: error })
        }
    })

    io.on('connection', (socket) => {
        const { user_id, verify } = socket.handshake.auth.decoded_authorization as TokenPayload
        console.log(`user ${user_id} connected (socket: ${socket.id})`)

        // Check for concurrent login
        const existingSocketId = users[user_id]?.socket_id
        if (existingSocketId && existingSocketId !== socket.id) {
            console.log(`Concurrent login detected for user ${user_id}. Notifying old socket ${existingSocketId}`)
            io.to(existingSocketId).emit('concurrent_login', {
                message: 'Tài khoản đang được đăng nhập ở thiết bị khác, vui lòng đăng xuất'
            })
        }

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
            // Check if user is verified before allowing to send message
            if (verify !== UserVerifyStatus.Verified) {
                return socket.emit('error', {
                    message: USER_MESSAGES.USER_NOT_VERIFIED,
                    status: HTTP_STATUS.FORBIDDEN
                })
            }

            const { receiver_id, sender_id, content, medias } = data.payload
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
                content: content || '',
                medias: medias || [],
                is_accepted: is_accepted
            })
            const result = await databaseService.conversations.insertOne(conversation)
            conversation._id = result.insertedId

            // Fetch sender info for the notification
            const sender = await databaseService.users.findOne(
                { _id: new ObjectId(sender_id) },
                {
                    projection: {
                        password: 0,
                        email_verify_token: 0,
                        forgot_password_token: 0,
                        twizz_circle: 0
                    }
                }
            )

            const messagePayload = {
                payload: {
                    ...conversation,
                    sender: sender
                }
            }

            const receiverUser = await databaseService.users.findOne({ _id: new ObjectId(receiver_id) })
            const receiverSetting = receiverUser?.notification_setting ?? NotificationSetting.Everyone

            let shouldSend = true
            if (receiverSetting === NotificationSetting.Off) {
                shouldSend = false
            } else if (receiverSetting === NotificationSetting.Following) {
                // isFollower check (receiver follows sender)
                if (!isFollower) {
                    shouldSend = false
                }
            }

            if (shouldSend) {
                if (receiver_socket_id) {
                    socket.to(receiver_socket_id).emit('receive_message', messagePayload)
                } else {
                    // Người nhận không online → gửi FCM push notification
                    await firebaseService.sendNotification({
                        user_id: receiver_id,
                        title: sender?.name || 'Tin nhắn mới',
                        body: content || (medias?.length > 0 ? (medias[0].type === 0 ? 'Đã gửi ảnh' : 'Đã gửi video') : 'Tin nhắn mới'),
                        data: {
                            type: 'message',
                            sender_id: sender_id,
                            sender_name: sender?.name || '',
                            sender_username: sender?.username || '',
                            sender_avatar: sender?.avatar || '',
                            conversation_id: conversation._id!.toString(),
                        }
                    })
                }
            }
            // Also emit back to the sender for confirmation/UI update
            socket.emit('receive_message', messagePayload)
        })
        socket.on('disconnect', () => {
            if (users[user_id]?.socket_id === socket.id) {
                delete users[user_id]
            }
            console.log(`user ${user_id} disconnected`)
        })
    })
}

export default initSocket
