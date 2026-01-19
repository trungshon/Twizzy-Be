import databaseService from './database.services'
import { ObjectId } from 'mongodb'
import Like from '~/models/schemas/Like.schema'
import { TwizzType } from '~/constants/enum'

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

  async getUserLikedTwizzs({
    user_id,
    viewer_user_id,
    limit,
    page
  }: {
    user_id: string
    viewer_user_id?: string
    limit: number
    page: number
  }) {
    const user_id_objectId = new ObjectId(user_id)
    const viewer_user_id_objectId = viewer_user_id ? new ObjectId(viewer_user_id) : null

    const [twizzs, total] = await Promise.all([
      databaseService.likes
        .aggregate([
          {
            $match: {
              user_id: user_id_objectId
            }
          },
          {
            $sort: { created_at: -1 }
          },
          {
            $skip: (page - 1) * limit
          },
          {
            $limit: limit
          },
          {
            $lookup: {
              from: 'twizzs',
              localField: 'twizz_id',
              foreignField: '_id',
              as: 'twizz'
            }
          },
          {
            $unwind: {
              path: '$twizz'
            }
          },
          {
            $replaceRoot: {
              newRoot: '$twizz'
            }
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
          // Lookup parent twizz for quote/comment
          {
            $lookup: {
              from: 'twizzs',
              localField: 'parent_id',
              foreignField: '_id',
              as: 'parent_twizz',
              pipeline: [
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
                    path: '$user',
                    preserveNullAndEmptyArrays: true
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
                ...(viewer_user_id_objectId
                  ? [
                      {
                        $lookup: {
                          from: 'likes',
                          localField: '_id',
                          foreignField: 'twizz_id',
                          as: 'user_likes',
                          pipeline: [
                            {
                              $match: {
                                user_id: viewer_user_id_objectId
                              }
                            }
                          ]
                        }
                      },
                      {
                        $lookup: {
                          from: 'bookmarks',
                          localField: '_id',
                          foreignField: 'twizz_id',
                          as: 'user_bookmarks',
                          pipeline: [
                            {
                              $match: {
                                user_id: viewer_user_id_objectId
                              }
                            }
                          ]
                        }
                      }
                    ]
                  : []),
                {
                  $addFields: {
                    bookmarks: { $size: '$bookmarks' },
                    likes: { $size: '$likes' },
                    is_liked: viewer_user_id_objectId ? { $gt: [{ $size: '$user_likes' }, 0] } : false,
                    is_bookmarked: viewer_user_id_objectId ? { $gt: [{ $size: '$user_bookmarks' }, 0] } : false,
                    comment_count: {
                      $size: {
                        $filter: {
                          input: '$twizz_children',
                          as: 'item',
                          cond: { $eq: ['$$item.type', TwizzType.Comment] }
                        }
                      }
                    },
                    quote_count: {
                      $size: {
                        $filter: {
                          input: '$twizz_children',
                          as: 'item',
                          cond: { $eq: ['$$item.type', TwizzType.QuoteTwizz] }
                        }
                      }
                    }
                  }
                },
                {
                  $project: {
                    twizz_children: 0,
                    user_likes: 0,
                    user_bookmarks: 0,
                    user: {
                      password: 0,
                      email_verify_token: 0,
                      twizz_circle: 0,
                      email_verify_otp: 0,
                      email_verify_otp_expires_at: 0,
                      forgot_password_token: 0,
                      forgot_password_otp: 0,
                      forgot_password_otp_expires_at: 0,
                      date_of_birth: 0
                    }
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              parent_twizz: { $arrayElemAt: ['$parent_twizz', 0] }
            }
          },
          {
            $lookup: {
              from: 'likes',
              localField: '_id',
              foreignField: 'twizz_id',
              as: 'user_likes',
              pipeline: viewer_user_id_objectId
                ? [
                    {
                      $match: {
                        user_id: viewer_user_id_objectId
                      }
                    }
                  ]
                : []
            }
          },
          {
            $lookup: {
              from: 'bookmarks',
              localField: '_id',
              foreignField: 'twizz_id',
              as: 'user_bookmarks',
              pipeline: viewer_user_id_objectId
                ? [
                    {
                      $match: {
                        user_id: viewer_user_id_objectId
                      }
                    }
                  ]
                : []
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
              is_liked: {
                $gt: [{ $size: '$user_likes' }, 0]
              },
              is_bookmarked: {
                $gt: [{ $size: '$user_bookmarks' }, 0]
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
              user_likes: 0,
              user_bookmarks: 0,
              user: {
                password: 0,
                email_verify_token: 0,
                twizz_circle: 0,
                email_verify_otp: 0,
                email_verify_otp_expires_at: 0,
                forgot_password_token: 0,
                forgot_password_otp: 0,
                forgot_password_otp_expires_at: 0,
                date_of_birth: 0
              }
            }
          }
        ])
        .toArray(),
      databaseService.likes.countDocuments({
        user_id: user_id_objectId
      })
    ])

    return { twizzs, total }
  }

  async getUsersWhoLikedTwizz({
    twizz_id,
    viewer_user_id,
    limit,
    page
  }: {
    twizz_id: string
    viewer_user_id?: string
    limit: number
    page: number
  }) {
    const twizz_id_objectId = new ObjectId(twizz_id)
    const viewer_user_id_objectId = viewer_user_id ? new ObjectId(viewer_user_id) : null

    const [users, total] = await Promise.all([
      databaseService.likes
        .aggregate([
          {
            $match: {
              twizz_id: twizz_id_objectId
            }
          },
          {
            $sort: { created_at: -1 }
          },
          {
            $skip: (page - 1) * limit
          },
          {
            $limit: limit
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
            $replaceRoot: {
              newRoot: '$user'
            }
          },
          ...(viewer_user_id_objectId
            ? [
                {
                  $lookup: {
                    from: 'followers',
                    let: { user_id: '$_id' },
                    pipeline: [
                      {
                        $match: {
                          $expr: {
                            $and: [
                              { $eq: ['$followed_user_id', '$$user_id'] },
                              { $eq: ['$user_id', viewer_user_id_objectId] }
                            ]
                          }
                        }
                      }
                    ],
                    as: 'is_following_check'
                  }
                },
                {
                  $addFields: {
                    is_following: { $gt: [{ $size: '$is_following_check' }, 0] }
                  }
                }
              ]
            : []),
          {
            $project: {
              password: 0,
              email_verify_token: 0,
              twizz_circle: 0,
              email_verify_otp: 0,
              email_verify_otp_expires_at: 0,
              forgot_password_token: 0,
              forgot_password_otp: 0,
              forgot_password_otp_expires_at: 0,
              date_of_birth: 0,
              is_following_check: 0
            }
          }
        ])
        .toArray(),
      databaseService.likes.countDocuments({
        twizz_id: twizz_id_objectId
      })
    ])

    return { users, total }
  }
}

const likesService = new LikesService()
export default likesService
