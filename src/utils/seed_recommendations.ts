import { faker } from '@faker-js/faker'
import { ObjectId } from 'mongodb'
import databaseService from '~/services/database.services'
import User from '~/models/schemas/User.schema'
import Hashtag from '~/models/schemas/Hashtag.schema'
import Twizz from '~/models/schemas/Twizz.schema'
import Like from '~/models/schemas/Like.schema'
import Follower from '~/models/schemas/Follower.schema'
import { hashPassword } from '~/utils/crypto'
import { TwizzAudience, TwizzType, UserVerifyStatus } from '~/constants/enum'

/**
 * Seed dữ liệu chuyên để test hệ thống gợi ý.
 *
 * Mục tiêu: tạo data có chủ đích để test đủ các nhánh:
 * - Cold Start: không follow / có follow
 * - Content-Based only (< ngưỡng)
 * - Hybrid (>= ngưỡng + có similar users)
 * - Hybrid fallback (>= ngưỡng nhưng không có similar users)
 * - Pagination/pool refresh (nhiều bài để lướt)
 * - Trending (tạo likes/comments/quotes trong 7 ngày gần nhất)
 *
 * Script này insert trực tiếp vào DB để tránh moderation làm chậm/failed.
 */

const SEED_TAG = 'seed_reco_2026'
const PASSWORD = 'Aa1!aaaa'

const TOPICS = ['football', 'cooking', 'tech', 'movie', 'travel', 'music', 'finance', 'health'] as const

type Topic = (typeof TOPICS)[number]

function emailFor(key: string) {
  return `${SEED_TAG}+${key}@example.com`
}

function usernameFor(key: string) {
  return `${SEED_TAG}_${key}`
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pickTopic(except?: Topic): Topic {
  const pool = except ? TOPICS.filter((t) => t !== except) : TOPICS
  return pool[randInt(0, pool.length - 1)]
}

function recentDateWithinDays(days: number) {
  const now = Date.now()
  const ms = randInt(0, days * 24 * 60 * 60 * 1000)
  return new Date(now - ms)
}

async function upsertHashtags(names: string[]) {
  const docs = await Promise.all(
    names.map(async (name) => {
      const existing = await databaseService.hashtags.findOne({ name })
      if (existing?._id) return existing._id
      const hashtag = new Hashtag({ name })
      await databaseService.hashtags.insertOne(hashtag)
      return hashtag._id as ObjectId
    })
  )
  return new Map(names.map((n, i) => [n, docs[i]]))
}

async function cleanupOldSeedData() {
  // Xóa theo email prefix để tránh xóa nhầm data thật
  const users = await databaseService.users
    .find({ email: { $regex: `^${SEED_TAG}\\+` } }, { projection: { _id: 1 } })
    .toArray()
  const userIds = users.map((u) => u._id as ObjectId)

  if (userIds.length === 0) return

  // Xóa likes của nhóm user seed
  await databaseService.likes.deleteMany({ user_id: { $in: userIds } })
  // Xóa followers liên quan (cả chiều follower & followed)
  await databaseService.followers.deleteMany({
    $or: [{ user_id: { $in: userIds } }, { followed_user_id: { $in: userIds } }]
  })
  // Xóa twizzs do nhóm user seed tạo (bao gồm comment/quote)
  await databaseService.twizzs.deleteMany({ user_id: { $in: userIds } })
  // Xóa users
  await databaseService.users.deleteMany({ _id: { $in: userIds } })
}

async function createUser(key: string) {
  const userId = new ObjectId()
  const now = new Date()
  const user = new User({
    _id: userId,
    name: faker.internet.displayName(),
    email: emailFor(key),
    username: usernameFor(key),
    password: await hashPassword(PASSWORD),
    date_of_birth: faker.date.birthdate({ min: 18, max: 35, mode: 'age' }),
    verify: UserVerifyStatus.Verified,
    created_at: now,
    updated_at: now
  })
  await databaseService.users.insertOne(user)
  return userId
}

async function createBackgroundUsers(count: number) {
  const ids: ObjectId[] = []
  for (let i = 0; i < count; i++) {
    ids.push(await createUser(`bg_${i + 1}`))
  }
  return ids
}

async function createTwizz(authorId: ObjectId, topic: Topic, createdAt?: Date) {
  const tagText = `#${topic}`
  const content = `${faker.lorem.paragraph({ min: 10, max: 60 })}\n\n${tagText} ${faker.lorem.sentence()}`
  const now = createdAt ?? new Date()

  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.Twizz,
    audience: TwizzAudience.Everyone,
    content,
    parent_id: null,
    hashtags: [], // set sau khi có hashtag ids
    mentions: [],
    medias: [],
    guest_views: 0,
    user_views: 0,
    created_at: now,
    updated_at: now
  })
  return twizz
}

async function createComment(authorId: ObjectId, parentTwizzId: ObjectId) {
  const now = recentDateWithinDays(7)
  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.Comment,
    audience: TwizzAudience.Everyone,
    content: faker.lorem.sentence(),
    parent_id: parentTwizzId.toString(),
    hashtags: [],
    mentions: [],
    medias: [],
    created_at: now,
    updated_at: now
  })
  await databaseService.twizzs.insertOne(twizz)
  return twizz._id as ObjectId
}

async function createQuote(authorId: ObjectId, parentTwizzId: ObjectId) {
  const now = recentDateWithinDays(7)
  const twizz = new Twizz({
    _id: new ObjectId(),
    user_id: authorId,
    type: TwizzType.QuoteTwizz,
    audience: TwizzAudience.Everyone,
    content: `Quote: ${faker.lorem.sentence()}`,
    parent_id: parentTwizzId.toString(),
    hashtags: [],
    mentions: [],
    medias: [],
    created_at: now,
    updated_at: now
  })
  await databaseService.twizzs.insertOne(twizz)
  return twizz._id as ObjectId
}

async function likeTwizz(userId: ObjectId, twizzId: ObjectId) {
  await databaseService.likes.insertOne(
    new Like({
      user_id: userId,
      twizz_id: twizzId,
      created_at: recentDateWithinDays(7)
    })
  )
}

async function follow(userId: ObjectId, followedUserId: ObjectId) {
  await databaseService.followers.insertOne(
    new Follower({
      user_id: userId,
      followed_user_id: followedUserId,
      created_at: recentDateWithinDays(30)
    })
  )
}

async function main() {
  await databaseService.connect()

  console.log(`[seed] Cleanup old seed data (${SEED_TAG})...`)
  await cleanupOldSeedData()

  console.log('[seed] Upsert hashtags...')
  const hashtagMap = await upsertHashtags([...TOPICS])

  console.log('[seed] Create dedicated test users...')
  const userColdNoFollow = await createUser('cold_no_follow')
  const userColdFollow = await createUser('cold_follow')
  const userContentOnly = await createUser('content_only')
  const userHybrid = await createUser('hybrid')
  const userHybridFallback = await createUser('hybrid_fallback')

  console.log('[seed] Create background users...')
  const bgUsers = await createBackgroundUsers(30)

  console.log('[seed] Create twizz pool (>= 200)...')
  const twizzPool: Array<{ _id: ObjectId; topic: Topic; authorId: ObjectId }> = []
  const twizzDocs: Twizz[] = []

  for (let i = 0; i < 220; i++) {
    const topic = TOPICS[i % TOPICS.length]
    const authorId = bgUsers[i % bgUsers.length]
    const createdAt = recentDateWithinDays(7) // giúp trending tính trong 7 ngày
    const twizz = await createTwizz(authorId, topic, createdAt)
    // gắn hashtag id
    twizz.hashtags = [hashtagMap.get(topic) as ObjectId]
    twizzDocs.push(twizz)
    twizzPool.push({ _id: twizz._id as ObjectId, topic, authorId })
  }

  await databaseService.twizzs.insertMany(twizzDocs)

  // ========= Cold Start =========
  // - cold_no_follow: không làm gì
  // - cold_follow: follow vài bg users để test 70/30 following/trending
  console.log('[seed] Setup cold start follow graph...')
  await Promise.all([
    follow(userColdFollow, bgUsers[0]),
    follow(userColdFollow, bgUsers[1]),
    follow(userColdFollow, bgUsers[2])
  ])

  // ========= Trending baseline =========
  // Tạo một số bài “hot” bằng cách cho nhiều bg users like/comment/quote vào cùng 1 nhóm bài
  console.log('[seed] Create trending interactions...')
  const hotTwizzIds = twizzPool.slice(0, 15).map((t) => t._id)
  for (const bg of bgUsers.slice(0, 20)) {
    // mỗi bg user like 5 hot posts
    for (const id of faker.helpers.arrayElements(hotTwizzIds, 5)) {
      await likeTwizz(bg, id)
    }
    // và comment 1-2 hot posts
    for (const id of faker.helpers.arrayElements(hotTwizzIds, randInt(1, 2))) {
      await createComment(bg, id)
    }
    // và quote 0-1 hot posts
    if (Math.random() < 0.4) {
      await createQuote(bg, faker.helpers.arrayElement(hotTwizzIds))
    }
  }

  // ========= Content-Based only user =========
  // Mục tiêu: effective < 15 hoặc distinct < 8.
  // Tạo 5 likes cùng 1 topic để content-based dễ thấy rõ.
  console.log('[seed] Setup content-only user interactions...')
  const contentTopic: Topic = 'football'
  const footballTwizz = twizzPool
    .filter((t) => t.topic === contentTopic)
    .slice(0, 10)
    .map((t) => t._id)
  for (const id of footballTwizz.slice(0, 5)) {
    await likeTwizz(userContentOnly, id)
  }

  // ========= Hybrid user =========
  // Mục tiêu: effective >= 15 và distinct >= 8.
  // Tạo: 9 likes + 3 comments + 2 quotes (distinct >= 8).
  console.log('[seed] Setup hybrid user interactions...')
  const hybridTopic: Topic = 'tech'
  const techTwizz = twizzPool
    .filter((t) => t.topic === hybridTopic)
    .slice(0, 30)
    .map((t) => t._id)

  // likes: 9 distinct
  for (const id of techTwizz.slice(0, 9)) {
    await likeTwizz(userHybrid, id)
  }
  // comments: 3 distinct
  for (const id of techTwizz.slice(9, 12)) {
    await createComment(userHybrid, id)
  }
  // quotes: 2 distinct
  for (const id of techTwizz.slice(12, 14)) {
    await createQuote(userHybrid, id)
  }

  // Tạo 5 user “tương tự” bằng cách họ cũng like/comment cùng các bài tech đó (để CF ra kết quả)
  const similarUsers = bgUsers.slice(20, 25)
  for (const u of similarUsers) {
    // overlap likes với hybrid user
    for (const id of techTwizz.slice(0, 7)) {
      await likeTwizz(u, id)
    }
    // họ cũng like thêm vài bài tech khác để tạo candidate cho hybrid user
    for (const id of techTwizz.slice(14, 22)) {
      if (Math.random() < 0.6) await likeTwizz(u, id)
    }
    // thêm 1 comment để tăng tín hiệu
    await createComment(u, techTwizz[0])
  }

  // ========= Hybrid fallback user =========
  // Mục tiêu: effective >= 15 nhưng không có similar users.
  // Cách làm: tạo 20 bài “ngách” và chỉ userHybridFallback tương tác.
  console.log('[seed] Setup hybrid-fallback user interactions...')
  const nicheAuthor = bgUsers[bgUsers.length - 1]
  const nicheTopic = pickTopic('tech')
  const nicheTwizzDocs: Twizz[] = []
  const nicheTwizzIds: ObjectId[] = []
  for (let i = 0; i < 25; i++) {
    const createdAt = recentDateWithinDays(7)
    const twizz = await createTwizz(nicheAuthor, nicheTopic, createdAt)
    twizz.hashtags = [hashtagMap.get(nicheTopic) as ObjectId]
    nicheTwizzDocs.push(twizz)
    nicheTwizzIds.push(twizz._id as ObjectId)
  }
  await databaseService.twizzs.insertMany(nicheTwizzDocs)

  // 10 likes + 5 comments + 2 quotes => effective = 10 + 6 + 3 = 19
  for (const id of nicheTwizzIds.slice(0, 10)) await likeTwizz(userHybridFallback, id)
  for (const id of nicheTwizzIds.slice(10, 15)) await createComment(userHybridFallback, id)
  for (const id of nicheTwizzIds.slice(15, 17)) await createQuote(userHybridFallback, id)

  console.log('\n========== SEED DONE ==========')
  console.log('Password (cho tất cả users seed):', PASSWORD)
  console.log('\nCác user test (login bằng POST /users/login):')
  console.log('- Cold start (no follow):', emailFor('cold_no_follow'))
  console.log('- Cold start (has follow):', emailFor('cold_follow'))
  console.log('- Content-based only:', emailFor('content_only'))
  console.log('- Hybrid:', emailFor('hybrid'))
  console.log('- Hybrid fallback:', emailFor('hybrid_fallback'))
  console.log('\nGợi ý test nhanh:')
  console.log('- GET /recommendations?limit=20&page=1 (mỗi user)') // kiểm tra metadata khác nhau
  console.log('- Pagination/pool refresh: gọi page=1..4 với limit=20')
  console.log('==============================\n')
}

main().catch((err) => {
  console.error('[seed] Failed:', err)
  process.exit(1)
})
