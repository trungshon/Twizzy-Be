import { ObjectId } from 'mongodb'

interface BookmarkType {
  _id?: ObjectId
  user_id: ObjectId
  twizz_id: ObjectId
  created_at?: Date
}

class Bookmark {
  _id: ObjectId
  user_id: ObjectId
  twizz_id: ObjectId
  created_at?: Date
  constructor({ _id, user_id, twizz_id, created_at }: BookmarkType) {
    this._id = _id || new ObjectId()
    this.user_id = user_id
    this.twizz_id = twizz_id
    this.created_at = created_at || new Date()
  }
}

export default Bookmark
