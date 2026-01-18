import { TwizzReqBody } from '~/models/requests/Twizz.requests'
import databaseService from './database.services'
import Twizz from '~/models/schemas/Twizz.schema'
import { ObjectId, WithId } from 'mongodb'
import Hashtag from '~/models/schemas/Hashtag.schema'
import { TwizzType } from '~/constants/enum'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Errors'
import { TWIZZ_MESSAGES } from '~/constants/messages'

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
    if (body.type === TwizzType.Retwizz && body.parent_id) {
      const existingRetwizz = await databaseService.twizzs.findOne({
        user_id: new ObjectId(user_id),
        parent_id: new ObjectId(body.parent_id),
        type: TwizzType.Retwizz
      })
      if (existingRetwizz) {
        throw new ErrorWithStatus({
          message: 'Bạn đã đăng lại bài viết này rồi',
          status: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }
    }

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
    // Populate user info and other data using aggregation
    const twizzs = await databaseService.twizzs
      .aggregate([
        {
          $match: {
            _id: result.insertedId
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
            from: 'likes',
            localField: '_id',
            foreignField: 'twizz_id',
            as: 'user_likes',
            pipeline: [
              {
                $match: {
                  user_id: new ObjectId(user_id)
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
                  user_id: new ObjectId(user_id)
                }
              }
            ]
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
            is_liked: {
              $gt: [{ $size: '$user_likes' }, 0]
            },
            is_bookmarked: {
              $gt: [{ $size: '$user_bookmarks' }, 0]
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
      .toArray()
    return twizzs[0]
  }

  async increaseView(twizz_id: string, user_id?: string) {
    const inc = user_id ? { user_views: 1 } : { guest_views: 1 }
    const result = await databaseService.twizzs.findOneAndUpdate(
      { _id: new ObjectId(twizz_id) },
      { $inc: inc, $currentDate: { updated_at: true } },
      { returnDocument: 'after', projection: { user_views: 1, guest_views: 1, updated_at: 1 } }
    )
    return result as WithId<{ user_views: number; guest_views: number; updated_at: Date }>
  }

  async getTwizzChildren({
    twizz_id,
    twizz_type,
    limit,
    page,
    user_id
  }: {
    twizz_id: string
    twizz_type: TwizzType
    limit: number
    page: number
    user_id?: string
  }) {
    const twizzs = await databaseService.twizzs
      .aggregate<Twizz>([
        {
          $match: {
            parent_id: new ObjectId(twizz_id),
            type: twizz_type
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
            twizz_children: 0
          }
        },
        {
          $skip: (page - 1) * limit // Công thức phân trang
        },
        {
          $limit: limit
        }
      ])
      .toArray()
    const ids = twizzs.map((twizz) => twizz._id as ObjectId)
    const inc = user_id ? { user_views: 1 } : { guest_views: 1 }
    const date = new Date()
    const [, total] = await Promise.all([
      databaseService.twizzs.updateMany({ _id: { $in: ids } }, { $inc: inc, $set: { updated_at: date } }),
      databaseService.twizzs.countDocuments({ parent_id: new ObjectId(twizz_id), type: twizz_type })
    ])
    twizzs.forEach((twizz) => {
      twizz.updated_at = date
      if (user_id) {
        twizz.user_views = twizz.user_views + 1
      } else {
        twizz.guest_views = twizz.guest_views + 1
      }
    })
    return {
      twizzs,
      total
    }
  }

  async getNewFeeds({ user_id, limit, page }: { user_id: string; limit: number; page: number }) {
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
    // Mong muốn newfeeds sẽ lấy luôn cả twizz của mình
    ids.push(user_id_objectId)
    const [twizzs, total] = await Promise.all([
      databaseService.twizzs
        .aggregate([
          {
            $match: {
              user_id: {
                $in: ids
              }
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
                        $in: [user_id_objectId]
                      }
                    }
                  ]
                }
              ]
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
          // Lookup parent twizz for retwizz/quote/comment
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
                {
                  $lookup: {
                    from: 'likes',
                    localField: '_id',
                    foreignField: 'twizz_id',
                    as: 'user_likes',
                    pipeline: [
                      {
                        $match: {
                          user_id: user_id_objectId
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
                          user_id: user_id_objectId
                        }
                      }
                    ]
                  }
                },
                {
                  $lookup: {
                    from: 'twizzs',
                    localField: '_id',
                    foreignField: 'parent_id',
                    as: 'user_retwizz',
                    pipeline: [
                      {
                        $match: {
                          user_id: user_id_objectId,
                          type: TwizzType.Retwizz
                        }
                      }
                    ]
                  }
                },
                {
                  $addFields: {
                    bookmarks: { $size: '$bookmarks' },
                    likes: { $size: '$likes' },
                    is_liked: { $gt: [{ $size: '$user_likes' }, 0] },
                    is_bookmarked: { $gt: [{ $size: '$user_bookmarks' }, 0] },
                    is_retwizzed: { $gt: [{ $size: '$user_retwizz' }, 0] },
                    user_retwizz_id: { $arrayElemAt: ['$user_retwizz._id', 0] },
                    retwizz_count: {
                      $size: {
                        $filter: {
                          input: '$twizz_children',
                          as: 'item',
                          cond: { $eq: ['$$item.type', TwizzType.Retwizz] }
                        }
                      }
                    },
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
              pipeline: [
                {
                  $match: {
                    user_id: user_id_objectId
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
                    user_id: user_id_objectId
                  }
                }
              ]
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
              is_retwizzed: {
                $gt: [
                  {
                    $size: {
                      $filter: {
                        input: '$twizz_children',
                        as: 'item',
                        cond: {
                          $and: [
                            { $eq: ['$$item.type', TwizzType.Retwizz] },
                            { $eq: ['$$item.user_id', user_id_objectId] }
                          ]
                        }
                      }
                    }
                  },
                  0
                ]
              },
              user_retwizz_id: {
                $arrayElemAt: [
                  {
                    $map: {
                      input: {
                        $filter: {
                          input: '$twizz_children',
                          as: 'item',
                          cond: {
                            $and: [
                              { $eq: ['$$item.type', TwizzType.Retwizz] },
                              { $eq: ['$$item.user_id', user_id_objectId] }
                            ]
                          }
                        }
                      },
                      as: 'match',
                      in: '$$match._id'
                    }
                  },
                  0
                ]
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
            $addFields: {
              user_views: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.user_views',
                  else: '$user_views'
                }
              },
              guest_views: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.guest_views',
                  else: '$guest_views'
                }
              },
              updated_at: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.updated_at',
                  else: '$updated_at'
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
      databaseService.twizzs
        .aggregate([
          {
            $match: {
              user_id: {
                $in: ids
              }
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
                        $in: [user_id_objectId]
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
    return { twizzs, total: total.length > 0 ? total[0].total : 0 }
  }

  async getUserTwizzs({
    user_id,
    viewer_user_id,
    type,
    limit,
    page
  }: {
    user_id: string
    viewer_user_id?: string
    type?: TwizzType
    limit: number
    page: number
  }) {
    const user_id_objectId = new ObjectId(user_id)
    const viewer_user_id_objectId = viewer_user_id ? new ObjectId(viewer_user_id) : null

    // Build match condition
    const matchCondition: any = {
      user_id: user_id_objectId
    }

    if (type !== undefined) {
      matchCondition.type = type
      // If we are looking for non-retwizz/non-quote, we usually want top-level
      if (type === TwizzType.Twizz) {
        matchCondition.parent_id = null
      }
    } else {
      matchCondition.parent_id = null
    }

    const [twizzs, total] = await Promise.all([
      databaseService.twizzs
        .aggregate([
          {
            $match: matchCondition
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
          // Lookup parent twizz for retwizz/quote/comment
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
                    is_retwizzed: viewer_user_id_objectId
                      ? {
                          $gt: [
                            {
                              $size: {
                                $filter: {
                                  input: '$twizz_children',
                                  as: 'item',
                                  cond: {
                                    $and: [
                                      { $eq: ['$$item.type', TwizzType.Retwizz] },
                                      { $eq: ['$$item.user_id', viewer_user_id_objectId] }
                                    ]
                                  }
                                }
                              }
                            },
                            0
                          ]
                        }
                      : false,
                    user_retwizz_id: viewer_user_id_objectId
                      ? {
                          $arrayElemAt: [
                            {
                              $map: {
                                input: {
                                  $filter: {
                                    input: '$twizz_children',
                                    as: 'item',
                                    cond: {
                                      $and: [
                                        { $eq: ['$$item.type', TwizzType.Retwizz] },
                                        { $eq: ['$$item.user_id', viewer_user_id_objectId] }
                                      ]
                                    }
                                  }
                                },
                                as: 'match',
                                in: '$$match._id'
                              }
                            },
                            0
                          ]
                        }
                      : null,
                    retwizz_count: {
                      $size: {
                        $filter: {
                          input: '$twizz_children',
                          as: 'item',
                          cond: { $eq: ['$$item.type', TwizzType.Retwizz] }
                        }
                      }
                    },
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
              is_retwizzed: viewer_user_id_objectId
                ? {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: '$twizz_children',
                            as: 'item',
                            cond: {
                              $and: [
                                { $eq: ['$$item.type', TwizzType.Retwizz] },
                                { $eq: ['$$item.user_id', viewer_user_id_objectId] }
                              ]
                            }
                          }
                        }
                      },
                      0
                    ]
                  }
                : false,
              user_retwizz_id: viewer_user_id_objectId
                ? {
                    $arrayElemAt: [
                      {
                        $map: {
                          input: {
                            $filter: {
                              input: '$twizz_children',
                              as: 'item',
                              cond: {
                                $and: [
                                  { $eq: ['$$item.type', TwizzType.Retwizz] },
                                  { $eq: ['$$item.user_id', viewer_user_id_objectId] }
                                ]
                              }
                            }
                          },
                          as: 'match',
                          in: '$$match._id'
                        }
                      },
                      0
                    ]
                  }
                : null,
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
            $addFields: {
              user_views: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.user_views',
                  else: '$user_views'
                }
              },
              guest_views: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.guest_views',
                  else: '$guest_views'
                }
              },
              updated_at: {
                $cond: {
                  if: { $eq: ['$type', TwizzType.Retwizz] },
                  then: '$parent_twizz.updated_at',
                  else: '$updated_at'
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
      databaseService.twizzs.countDocuments(matchCondition)
    ])

    return { twizzs, total }
  }

  async deleteTwizz(user_id: string, twizz_id: string) {
    const twizz = await databaseService.twizzs.findOne({
      _id: new ObjectId(twizz_id)
    })

    if (!twizz) {
      throw new ErrorWithStatus({
        message: TWIZZ_MESSAGES.TWIZZ_NOT_EXISTS,
        status: HTTP_STATUS.NOT_FOUND
      })
    }

    // Check if user is the owner
    if (!twizz.user_id.equals(new ObjectId(user_id))) {
      throw new ErrorWithStatus({
        message: TWIZZ_MESSAGES.CANNOT_DELETE_TWIZZ,
        status: HTTP_STATUS.FORBIDDEN
      })
    }

    // Delete the twizz and its children
    await Promise.all([
      databaseService.twizzs.deleteOne({
        _id: new ObjectId(twizz_id)
      }),
      databaseService.twizzs.deleteMany({
        parent_id: new ObjectId(twizz_id)
      })
    ])

    return { message: TWIZZ_MESSAGES.DELETE_TWIZZ_SUCCESSFULLY }
  }
}

const twizzsService = new TwizzsService()
export default twizzsService
