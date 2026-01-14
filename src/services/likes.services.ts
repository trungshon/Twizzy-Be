import databaseService from './database.services'
import { ObjectId } from 'mongodb'
import Like from '~/models/schemas/Like.schema'

class LikesService {
  async likeTwizz(user_id: string, twizz_id: string) {
    const result = await databaseService.likes.findOneAndUpdate(
      { user_id: new ObjectId(user_id), twizz_id: new ObjectId(twizz_id) },
      { $setOnInsert: new Like({ user_id: new ObjectId(user_id), twizz_id: new ObjectId(twizz_id) }) },
      { upsert: true, returnDocument: 'after' }
    )
    return result
  }

  async unlikeTwizz(user_id: string, twizz_id: string) {
    const result = await databaseService.likes.findOneAndDelete({
      user_id: new ObjectId(user_id),
      twizz_id: new ObjectId(twizz_id)
    })
    return result
  }
}

const likesService = new LikesService()
export default likesService
