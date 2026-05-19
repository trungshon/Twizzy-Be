import { MongoClient, Db, Collection, Int32 } from 'mongodb'
import { config } from 'dotenv'
import User from '~/models/schemas/User.schema'
import RefreshToken from '~/models/schemas/RefreshToken.schema'
import Follower from '~/models/schemas/Follower.schema'
import Twizz from '~/models/schemas/Twizz.schema'
import Hashtag from '~/models/schemas/Hashtag.schema'
import Bookmark from '~/models/schemas/Bookmark.schema'
import Like from '~/models/schemas/Like.schema'
import Conversation from '~/models/schemas/Conversations.schema'
import Notification from '~/models/schemas/Notification.schema'
import Report from '~/models/schemas/Report.schema'
import RecommendationView from '~/models/schemas/RecommendationView.schema'
config()

const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@twizzy.glhnqkl.mongodb.net/?appName=Twizzy`

class DatabaseService {
  private client: MongoClient
  private db: Db
  constructor() {
    this.client = new MongoClient(uri)
    this.db = this.client.db(process.env.DB_NAME)
  }

  async connect() {
    try {
      await this.db.command({ ping: 1 })
      console.log('Pinged your deployment. You successfully connected to MongoDB!')
    } catch (error) {
      console.log('Error connecting to MongoDB', error)
      throw error
    }
  }

  // Tự động bổ sung các trường bắt buộc của schema đối với các tài khoản cũ trong DB
  async migrateUsersSchema() {
    try {
      // 1. Cập nhật violation_count thành 0 cho các user chưa có
      const resViolation = await this.users.updateMany(
        { violation_count: { $exists: false } },
        { $set: { violation_count: new Int32(0) as any } }
      )
      if (resViolation.modifiedCount > 0) {
        console.log(`[Migration] Đã bổ sung violation_count cho ${resViolation.modifiedCount} người dùng cũ.`)
      }

      // 2. Cập nhật role thành 0 (UserRole.User) cho các user chưa có
      const resRole = await this.users.updateMany(
        { role: { $exists: false } },
        { $set: { role: new Int32(0) as any } }
      )
      if (resRole.modifiedCount > 0) {
        console.log(`[Migration] Đã bổ sung role cho ${resRole.modifiedCount} người dùng cũ.`)
      }

      // 3. Cập nhật fcm_tokens thành [] cho các user chưa có
      const resFcm = await this.users.updateMany(
        { fcm_tokens: { $exists: false } },
        { $set: { fcm_tokens: [] } }
      )
      if (resFcm.modifiedCount > 0) {
        console.log(`[Migration] Đã bổ sung fcm_tokens cho ${resFcm.modifiedCount} người dùng cũ.`)
      }
    } catch (error) {
      console.error('[Migration] Lỗi khi chạy migrateUsersSchema:', error)
    }
  }
  // tạo index cho users collection
  async indexUsers() {
    const exists = await this.users.indexExists(['email_1', 'username_1'])
    if (!exists) {
      this.users.createIndex({ email: 1 }, { unique: true })
      this.users.createIndex({ username: 1 }, { unique: true })
    }
  }
  // tạo index cho refresh_tokens collection
  async indexRefreshTokens() {
    const exists = await this.refreshTokens.indexExists(['token_1', 'exp_1'])
    if (!exists) {
      this.refreshTokens.createIndex({ token: 1 })
      this.refreshTokens.createIndex({ exp: 1 }, { expireAfterSeconds: 0 })
    }
  }
  // tạo index cho followers collection
  async indexFollowers() {
    const exists = await this.followers.indexExists(['user_id_1', 'followed_user_id_1'])
    if (!exists) {
      this.followers.createIndex({ user_id: 1, followed_user_id: 1 })
    }
  }
  // tạo index cho twizzs collection
  async indexTwizzs() {
    const exists = await this.twizzs.indexExists(['content_text'])
    if (!exists) {
      this.twizzs.createIndex({ content: 'text' }, { default_language: 'none' })
    }
  }
  // tạo index cho recommendation_views collection
  async indexRecommendationViews() {
    let exists = false
    try {
      exists = await this.recommendationViews.indexExists(['user_id_1_twizz_id_1'])
    } catch (error: any) {
      if (error.codeName !== 'NamespaceNotFound') {
        console.error('Error checking index:', error)
      }
    }

    if (!exists) {
      // Unique compound index: tránh ghi trùng (1 user chỉ có 1 bản ghi xem cho 1 bài)
      this.recommendationViews.createIndex({ user_id: 1, twizz_id: 1 }, { unique: true })
      // TTL index: tự động xóa bản ghi sau 30 ngày (2,592,000 giây)
      this.recommendationViews.createIndex({ created_at: 1 }, { expireAfterSeconds: 2592000 })
    }
  }

  get users(): Collection<User> {
    return this.db.collection(process.env.DB_USERS_COLLECTION as string)
  }

  get refreshTokens(): Collection<RefreshToken> {
    return this.db.collection(process.env.DB_REFRESH_TOKENS_COLLECTION as string)
  }

  get followers(): Collection<Follower> {
    return this.db.collection(process.env.DB_FOLLOWERS_COLLECTION as string)
  }

  get twizzs(): Collection<Twizz> {
    return this.db.collection(process.env.DB_TWIZZS_COLLECTION as string)
  }

  get hashtags(): Collection<Hashtag> {
    return this.db.collection(process.env.DB_HASHTAGS_COLLECTION as string)
  }

  get bookmarks(): Collection<Bookmark> {
    return this.db.collection(process.env.DB_BOOKMARKS_COLLECTION as string)
  }

  get likes(): Collection<Like> {
    return this.db.collection(process.env.DB_LIKES_COLLECTION as string)
  }

  get conversations(): Collection<Conversation> {
    return this.db.collection(process.env.DB_CONVERSATIONS_COLLECTION as string)
  }

  get notifications(): Collection<Notification> {
    return this.db.collection(process.env.DB_NOTIFICATIONS_COLLECTION as string)
  }

  get reports(): Collection<Report> {
    return this.db.collection(process.env.DB_REPORTS_COLLECTION as string)
  }

  get recommendationViews(): Collection<RecommendationView> {
    return this.db.collection(process.env.DB_RECOMMENDATION_VIEWS_COLLECTION as string)
  }
}

const databaseService = new DatabaseService()
export default databaseService
