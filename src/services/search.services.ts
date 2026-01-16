import databaseService from './database.services'
import { SearchQuery } from '~/models/requests/Search.requests'
import { ObjectId } from 'mongodb'
import { MediaType, MediaTypeQuery, PeopleFollow, TwizzType } from '~/constants/enum'

class SearchService {
  async search({
    content,
    limit,
    page,
    user_id,
    media_type,
    people_follow
  }: {
    limit: number
    page: number
    content: string
    user_id: string
    media_type?: MediaTypeQuery
    people_follow?: PeopleFollow
  }) {
    const $match: any = { $text: { $search: content } }
    if (media_type) {
      if (media_type === MediaTypeQuery.Image) {
        $match['medias.type'] = MediaType.Image
      }
      if (media_type === MediaTypeQuery.Video) {
        $match['medias.type'] = MediaType.Video
      }
    }
    if (people_follow && people_follow === PeopleFollow.Following) {
      const user_id_objectId = new ObjectId(user_id)
      const followed_users_ids = await databaseService.followers
        .find(
          {
            user_id: user_id_objectId
          },
          { projection: { followed_user_id: 1, _id: 0 } }
        )
        .toArray()
      const ids = followed_users_ids.map((item) => item.followed_user_id)
      // lấy luôn cả twizz của mình
      ids.push(user_id_objectId)
      $match['user_id'] = {
        $in: ids
      }
    }
    const [twizzs, total] = await Promise.all([
      databaseService.twizzs
        .aggregate([
          {
            $match
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user_id',
              foreignField: '_id',
              as: 'user'
            }
          },
          {
            $unwind: {
              path: '$user'
            }
          },
          {
            $match: {
              $or: [
                {
                  audience: 0
                },
                {
                  $and: [
                    {
                      audience: 1
                    },
                    {
                      'user.twizz_circle': {
                        $in: [new ObjectId(user_id)]
                      }
                    }
                  ]
                }
              ]
            }
          },
          {
            $lookup: {
              from: 'hashtags',
              localField: 'hashtags',
              foreignField: '_id',
              as: 'hashtags'
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'mentions',
              foreignField: '_id',
              as: 'mentions'
            }
          },
          {
            $addFields: {
              mentions: {
                $map: {
                  input: '$mentions',
                  as: 'mention',
                  in: {
                    _id: '$$mention._id',
                    name: '$$mention.name',
                    username: '$$mention.username',
                    email: '$$mention.email'
                  }
                }
              }
            }
          },
          {
            $lookup: {
              from: 'bookmarks',
              localField: '_id',
              foreignField: 'twizz_id',
              as: 'bookmarks'
            }
          },
          {
            $lookup: {
              from: 'likes',
              localField: '_id',
              foreignField: 'twizz_id',
              as: 'likes'
            }
          },
          {
            $lookup: {
              from: 'twizzs',
              localField: '_id',
              foreignField: 'parent_id',
              as: 'twizz_children'
            }
          },
          {
            $addFields: {
              bookmarks: {
                $size: '$bookmarks'
              },
              likes: {
                $size: '$likes'
              },
              retwizz_count: {
                $size: {
                  $filter: {
                    input: '$twizz_children',
                    as: 'item',
                    cond: {
                      $eq: ['$$item.type', TwizzType.Retwizz]
                    }
                  }
                }
              },
              comment_count: {
                $size: {
                  $filter: {
                    input: '$twizz_children',
                    as: 'item',
                    cond: {
                      $eq: ['$$item.type', TwizzType.Comment]
                    }
                  }
                }
              },
              quote_count: {
                $size: {
                  $filter: {
                    input: '$twizz_children',
                    as: 'item',
                    cond: {
                      $eq: ['$$item.type', TwizzType.QuoteTwizz]
                    }
                  }
                }
              }
            }
          },
          {
            $project: {
              twizz_children: 0,
              user: {
                password: 0,
                email_verify_token: 0,
                twizz_circle: 0,
                email_verify_otp: 0,
                email_verify_otp_expires_at: 0,
                forgot_password_otp: 0,
                forgot_password_otp_expires_at: 0,
                date_of_birth: 0
              }
            }
          },
          {
            $skip: (page - 1) * limit
          },
          {
            $limit: limit
          }
        ])
        .toArray(),
      databaseService.twizzs
        .aggregate([
          {
            $match
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user_id',
              foreignField: '_id',
              as: 'user'
            }
          },
          {
            $unwind: {
              path: '$user'
            }
          },
          {
            $match: {
              $or: [
                {
                  audience: 0
                },
                {
                  $and: [
                    {
                      audience: 1
                    },
                    {
                      'user.twizz_circle': {
                        $in: [new ObjectId(user_id)]
                      }
                    }
                  ]
                }
              ]
            }
          },
          {
            $count: 'total'
          }
        ])
        .toArray()
    ])
    if (total.length === 0) {
      return { twizzs, total: 0 }
    }
    const twizz_ids = twizzs.map((twizz) => twizz._id as ObjectId)
    const date = new Date()
    await databaseService.twizzs.updateMany(
      { _id: { $in: twizz_ids } },
      { $inc: { user_views: 1 }, $set: { updated_at: date } }
    )

    twizzs.forEach((twizz) => {
      twizz.updated_at = date
      twizz.user_views = twizz.user_views + 1
    })
    return { twizzs, total: total[0].total }
  }

  async searchUsers({
    content,
    limit,
    page,
    field
  }: {
    limit: number
    page: number
    content: string
    field?: 'username' | 'name'
  }) {
    const $match: any = {}

    // Build search query based on field
    if (field === 'username') {
      $match.username = { $regex: content, $options: 'i' }
    } else if (field === 'name') {
      $match.name = { $regex: content, $options: 'i' }
    } else {
      // Search in both username and name if field not specified
      $match.$or = [{ username: { $regex: content, $options: 'i' } }, { name: { $regex: content, $options: 'i' } }]
    }

    // Only return verified users
    $match.verify = 1

    const [users, totalResult] = await Promise.all([
      databaseService.users
        .find($match, {
          projection: {
            password: 0,
            email: 0,
            email_verify_token: 0,
            forgot_password_token: 0,
            email_verify_otp: 0,
            forgot_password_otp: 0,
            email_verify_otp_expires_at: 0,
            forgot_password_otp_expires_at: 0,
            date_of_birth: 0,
            twizz_circle: 0
          }
        })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      databaseService.users.countDocuments($match)
    ])

    return { users, total: totalResult }
  }
}

const searchService = new SearchService()
export default searchService
