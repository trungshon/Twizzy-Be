import { TwizzReqBody } from '~/models/requests/Twizz.requests'
import databaseService from './database.services'
import Twizz from '~/models/schemas/Twizz.schema'
import { ObjectId, WithId } from 'mongodb'
import Hashtag from '~/models/schemas/Hashtag.schema'

class TwizzsService {
  async checkAndCreateHashtags(hashtags: string[]) {
    const hashtagDocuments = await Promise.all(
      hashtags.map((hashtag) => {
        // tìm hashtag trong database, nếu không tìm thấy thì tạo mới
        return databaseService.hashtags.findOneAndUpdate(
          { name: hashtag },
          { $setOnInsert: new Hashtag({ name: hashtag }) },
          { upsert: true, returnDocument: 'after' }
        )
      })
    )
    return hashtagDocuments.map((hashtag) => (hashtag as WithId<Hashtag>)._id)
  }
  async createTwizz(user_id: string, body: TwizzReqBody) {
    const hashtags = await this.checkAndCreateHashtags(body.hashtags)
    const result = await databaseService.twizzs.insertOne(
      new Twizz({
        audience: body.audience,
        content: body.content,
        hashtags: hashtags,
        medias: body.medias,
        mentions: body.mentions,
        parent_id: body.parent_id,
        type: body.type,
        user_id: new ObjectId(user_id),
        user_views: 0,
        created_at: new Date(),
        updated_at: new Date()
      })
    )
    const twizz = await databaseService.twizzs.findOne({ _id: result.insertedId })
    return twizz
  }
}

const twizzsService = new TwizzsService()
export default twizzsService
