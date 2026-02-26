import admin from 'firebase-admin'
import path from 'path'
import databaseService from './database.services'
import { ObjectId } from 'mongodb'

// Khởi tạo Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json')
const serviceAccount = require(serviceAccountPath)

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
})

class FirebaseService {
    /**
     * Gửi push notification tới tất cả thiết bị của user
     */
    async sendNotification(payload: {
        user_id: string
        title: string
        body: string
        data?: Record<string, string> // Dữ liệu custom cho navigation
    }) {
        try {
            // Lấy danh sách FCM token của user
            const user = await databaseService.users.findOne(
                { _id: new ObjectId(payload.user_id) },
                { projection: { fcm_tokens: 1 } }
            )

            const tokens = user?.fcm_tokens || []
            if (tokens.length === 0) {
                console.log(`Không có FCM token cho user ${payload.user_id}, bỏ qua push notification`)
                return
            }

            // Tạo message gửi tới nhiều thiết bị
            const message: admin.messaging.MulticastMessage = {
                tokens,
                notification: {
                    title: payload.title,
                    body: payload.body,
                },
                data: payload.data || {},
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'twizzy_notifications',
                        icon: '@mipmap/ic_launcher',
                    }
                }
            }

            const response = await admin.messaging().sendEachForMulticast(message)
            console.log(`FCM: Gửi thành công ${response.successCount}/${tokens.length} thiết bị`)

            // Xóa các token không hợp lệ (thiết bị đã gỡ app, token hết hạn...)
            if (response.failureCount > 0) {
                const invalidTokens: string[] = []
                response.responses.forEach((resp, idx) => {
                    if (!resp.success) {
                        console.log(`FCM token lỗi: ${tokens[idx]} - ${resp.error?.message}`)
                        invalidTokens.push(tokens[idx])
                    }
                })
                if (invalidTokens.length > 0) {
                    await this.removeInvalidTokens(payload.user_id, invalidTokens)
                }
            }
        } catch (error) {
            console.error('FCM gửi notification lỗi:', error)
        }
    }

    /**
     * Lưu FCM token của user (khi login hoặc khi token refresh)
     * Tự động xóa token khỏi tất cả user khác trước để tránh trùng tài khoản
     */
    async saveFcmToken(user_id: string, token: string) {
        // Bước 1: Xóa token khỏi TẤT CẢ user khác (phòng trường hợp đổi tài khoản)
        await databaseService.users.updateMany(
            { _id: { $ne: new ObjectId(user_id) }, fcm_tokens: token },
            { $pull: { fcm_tokens: token } }
        )
        // Bước 2: Thêm token vào user hiện tại
        await databaseService.users.updateOne(
            { _id: new ObjectId(user_id) },
            { $addToSet: { fcm_tokens: token } }
        )
        console.log(`FCM token đã được lưu cho user ${user_id}`)
    }

    /**
     * Xóa FCM token (khi user logout)
     */
    async removeFcmToken(user_id: string, token: string) {
        await databaseService.users.updateOne(
            { _id: new ObjectId(user_id) },
            { $pull: { fcm_tokens: token } }
        )
        console.log(`FCM token đã được xóa cho user ${user_id}`)
    }

    /**
     * Xóa các token không hợp lệ (tự động gọi khi gửi notification thất bại)
     */
    private async removeInvalidTokens(user_id: string, tokens: string[]) {
        await databaseService.users.updateOne(
            { _id: new ObjectId(user_id) },
            { $pullAll: { fcm_tokens: tokens } }
        )
        console.log(`Đã xóa ${tokens.length} FCM token không hợp lệ cho user ${user_id}`)
    }
}

const firebaseService = new FirebaseService()
export default firebaseService
