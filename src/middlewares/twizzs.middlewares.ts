import { checkSchema } from 'express-validator'
import { MediaType, TwizzAudience, TwizzType, UserVerifyStatus } from '~/constants/enum'
import validate from '~/utils/validation'
import { numberEnumToArray } from '~/utils/commons'
import { TWIZZ_MESSAGES, USER_MESSAGES } from '~/constants/messages'
import { ObjectId } from 'mongodb'
import { isEmpty } from 'lodash'
import databaseService from '~/services/database.services'
import { ErrorWithStatus } from '~/models/Errors'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { NextFunction, Request, Response } from 'express'
import Twizz from '~/models/schemas/Twizz.schema'
import wrapRequestHandler from '~/utils/handlers'

const twizzType = numberEnumToArray(TwizzType)
const twizzAudience = numberEnumToArray(TwizzAudience)
const mediaType = numberEnumToArray(MediaType)
export const createTwizzValidator = validate(
  checkSchema({
    type: {
      in: 'body',
      isIn: {
        options: [twizzType],
        errorMessage: TWIZZ_MESSAGES.INVALID_TYPE
      }
    },
    audience: {
      in: 'body',
      isIn: {
        options: [twizzAudience],
        errorMessage: TWIZZ_MESSAGES.INVALID_AUDIENCE
      }
    },
    parent_id: {
      custom: {
        options: async (value, { req }) => {
          const type = req.body.type as TwizzType
          // Nếu `type` là retwizz, comment, quotetwizz thì `parent_id`
          // phải là `twizz_id` của twizz cha
          if ([TwizzType.Retwizz, TwizzType.Comment, TwizzType.QuoteTwizz].includes(type) && !ObjectId.isValid(value)) {
            throw new Error(TWIZZ_MESSAGES.INVALID_PARENT_ID)
          }
          // Nếu `type` là twizz thì `parent_id` phải là null
          if (type === TwizzType.Twizz && value !== null) {
            throw new Error(TWIZZ_MESSAGES.PARENT_ID_MUST_BE_NULL)
          }
          return true
        }
      }
    },
    content: {
      isString: true,
      custom: {
        options: async (value, { req }) => {
          const type = req.body.type as TwizzType
          const hashtags = req.body.hashtags as string[]
          const mentions = req.body.mentions as string[]
          // Nếu `type` là comment, quotetwizz, twizz và không có `mentions` và `hashtags`
          //  thì `content` phải là string và không được rỗngrỗng
          if (
            [TwizzType.Comment, TwizzType.QuoteTwizz, TwizzType.Twizz].includes(type) &&
            isEmpty(mentions) &&
            isEmpty(hashtags) &&
            value === ''
          ) {
            throw new Error(TWIZZ_MESSAGES.CONTENT_MUST_BE_A_NON_EMPTY_STRING)
          }

          // Nếu `type` là retwizz thì `content` phải là `''`
          if (type === TwizzType.Retwizz && value !== '') {
            throw new Error(TWIZZ_MESSAGES.CONTENT_MUST_BE_AN_EMPTY_STRING)
          }
          return true
        }
      }
    },
    hashtags: {
      isArray: true,
      custom: {
        options: async (value, { req }) => {
          // Yêu cầu mỗi phần tử trong array là string
          if (value.some((item: any) => typeof item !== 'string')) {
            throw new Error(TWIZZ_MESSAGES.HASHTAGS_MUST_BE_AN_ARRAY_OF_STRINGS)
          }
          return true
        }
      }
    },
    mentions: {
      isArray: true,
      custom: {
        options: async (value, { req }) => {
          // Yêu cầu mỗi phần tử trong array là user_id
          if (value.some((item: any) => !ObjectId.isValid(item))) {
            throw new Error(TWIZZ_MESSAGES.MENTIONS_MUST_BE_AN_ARRAY_OF_USER_IDS)
          }
          return true
        }
      }
    },
    medias: {
      isArray: true,
      custom: {
        options: async (value, { req }) => {
          // Yêu cầu mỗi phần tử trong array là Media Object
          if (
            value.some((item: any) => {
              return typeof item.url !== 'string' || !mediaType.includes(item.type)
            })
          ) {
            throw new Error(TWIZZ_MESSAGES.MEDIAS_MUST_BE_AN_ARRAY_OF_MEDIA_OBJECTS)
          }
          return true
        }
      }
    }
  })
)

export const twizzIdValidator = validate(
  checkSchema(
    {
      twizz_id: {
        custom: {
          options: async (value, { req }) => {
            if (!ObjectId.isValid(value)) {
              throw new ErrorWithStatus({
                message: TWIZZ_MESSAGES.INVALID_TWIZZ_ID,
                status: HTTP_STATUS.BAD_REQUEST
              })
            }
            const [twizz] = await databaseService.twizzs
              .aggregate<Twizz>([
                {
                  $match: {
                    _id: new ObjectId(value)
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
                            $eq: ['$$item.type', 1]
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
                            $eq: ['$$item.type', 2]
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
                            $eq: ['$$item.type', 3]
                          }
                        }
                      }
                    },
                    view: {
                      $add: ['$user_views', '$guest_views']
                    }
                  }
                },
                {
                  $project: {
                    twizz_children: 0
                  }
                }
              ])
              .toArray()
            if (!twizz) {
              throw new ErrorWithStatus({
                message: TWIZZ_MESSAGES.TWIZZ_NOT_EXISTS,
                status: HTTP_STATUS.NOT_FOUND
              })
            }
            ;(req as Request).twizz = twizz
            return true
          }
        }
      }
    },
    ['params', 'body']
  )
)

export const audienceValidator = wrapRequestHandler(async (req: Request, res: Response, next: NextFunction) => {
  const twizz = req.twizz as Twizz
  if (twizz.audience === TwizzAudience.TwizzCircle) {
    // Kiểm tra người xem twizz này đã đăng nhập hay chưa
    if (!req.decoded_authorization) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.ACCESS_TOKEN_IS_REQUIRED,
        status: HTTP_STATUS.UNAUTHORIZED
      })
    }
    // Kiểm tra tài khoản tác giả có bị khóa hay bị xóa hay chưa
    const author = await databaseService.users.findOne({ _id: new ObjectId(twizz.user_id) })
    if (!author || author.verify === UserVerifyStatus.Banned) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.USER_NOT_FOUND,
        status: HTTP_STATUS.NOT_FOUND
      })
    }
    // Kiểm tra người xem twizz này có thuộc twizz circle của người tác giả hay không
    const { user_id } = req.decoded_authorization
    const isInTwizzCircle = author.twizz_circle.some((user_circle_id) => user_circle_id.equals(user_id))
    if (!isInTwizzCircle && !author._id.equals(user_id)) {
      throw new ErrorWithStatus({
        message: TWIZZ_MESSAGES.TWIZZ_IS_NOT_PUBLIC,
        status: HTTP_STATUS.FORBIDDEN
      })
    }
  }
  next()
})
