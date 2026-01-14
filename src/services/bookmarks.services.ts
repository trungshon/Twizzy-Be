import databaseService from './database.services'
import Bookmark from '~/models/schemas/Bookmark.schema'
import { ObjectId } from 'mongodb'

class BookmarksService {
  async bookmarkTwizz(user_id: string, twizz_id: string) {
    const result = await databaseService.bookmarks.findOneAndUpdate(
      { user_id: new ObjectId(user_id), twizz_id: new ObjectId(twizz_id) },
      { $setOnInsert: new Bookmark({ user_id: new ObjectId(user_id), twizz_id: new ObjectId(twizz_id) }) },
      { upsert: true, returnDocument: 'after' }
    )
    return result
  }

  async unbookmarkTwizz(user_id: string, twizz_id: string) {
    const result = await databaseService.bookmarks.findOneAndDelete({
      user_id: new ObjectId(user_id),
      twizz_id: new ObjectId(twizz_id)
    })
    return result
  }
}

const bookmarksService = new BookmarksService()
export default bookmarksService
