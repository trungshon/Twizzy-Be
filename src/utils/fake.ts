import { faker } from '@faker-js/faker'
import { RegisterReqBody } from '~/models/requests/User.requests'
import { ObjectId } from 'mongodb'
import { TwizzReqBody } from '~/models/requests/Twizz.requests'
import { TwizzAudience, TwizzType, UserVerifyStatus } from '~/constants/enum'
import databaseService from '~/services/database.services'
import User from '~/models/schemas/User.schema'
import { hashPassword } from './crypto'
import Follower from '~/models/schemas/Follower.schema'
import twizzsService from '~/services/twizzs.services'

const PASSWORD = 'Ct060136@'
// Id của tài khoản của mình, dùng để follow người khác
const MYID = new ObjectId('6968e9e6fb2861d8165cc93a') // test1@test.com

// Số lượng user được tạo, mỗi user sẽ mặc định twizz 2 cái
const USER_COUNT = 100

const createRandomUser = () => {
  const user: RegisterReqBody = {
    name: faker.internet.displayName(),
    email: faker.internet.email(),
    password: PASSWORD,
    confirm_password: PASSWORD,
    date_of_birth: faker.date.past().toISOString()
  }
  return user
}

const createRandomTwizz = () => {
  const twizz: TwizzReqBody = {
    type: TwizzType.Twizz,
    audience: TwizzAudience.Everyone,
    content: faker.lorem.paragraph({ min: 10, max: 160 }),
    hashtags: [],
    mentions: [],
    medias: [],
    parent_id: null
  }
  return twizz
}

const users: RegisterReqBody[] = faker.helpers.multiple(createRandomUser, { count: USER_COUNT })

const insertMultipleUsers = async (users: RegisterReqBody[]) => {
  console.log('Creating users...')
  const result = await Promise.all(
    users.map(async (user) => {
      const user_id = new ObjectId()
      await databaseService.users.insertOne(
        new User({
          _id: user_id,
          ...user,
          username: `user${user_id.toString()}`,
          password: await hashPassword(user.password),
          date_of_birth: new Date(user.date_of_birth),
          verify: UserVerifyStatus.Verified
        })
      )
      return user_id
    })
  )
  console.log(`Created ${result.length} users`)
  return result
}

const followMultipleUsers = async (user_id: ObjectId, followed_user_ids: ObjectId[]) => {
  console.log('Start following ...')
  const result = await Promise.all(
    followed_user_ids.map((followed_user_id) => {
      databaseService.followers.insertOne(
        new Follower({
          user_id,
          followed_user_id: new ObjectId(followed_user_id)
        })
      )
    })
  )
  console.log(`Followed ${result.length} users`)
}

const insertMultipleTwizzs = async (ids: ObjectId[]) => {
  console.log('Creating twizzs ...')
  console.log(`Counting ...`)
  let count = 0
  const result = await Promise.all(
    ids.map(async (id, index) => {
      await Promise.all([
        twizzsService.createTwizz(id.toString(), createRandomTwizz()),
        twizzsService.createTwizz(id.toString(), createRandomTwizz())
      ])
      count += 2
      console.log(`Created ${count} twizzs`)
    })
  )
  return result
}

insertMultipleUsers(users).then((ids) => {
  followMultipleUsers(new ObjectId(MYID), ids)
  insertMultipleTwizzs(ids)
})
