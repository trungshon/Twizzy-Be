import { checkSchema } from 'express-validator'
import { MediaType, TwizzAudience, TwizzType } from '~/constants/enum'
import validate from '~/utils/validation'
import { numberEnumToArray } from '~/utils/commons'
import { TWIZZ_MESSAGES } from '~/constants/messages'
import { ObjectId } from 'mongodb'
import { isEmpty } from 'lodash'
import databaseService from '~/services/database.services'
import { ErrorWithStatus } from '~/models/Errors'
import { HTTP_STATUS } from '~/constants/httpStatus'

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
            const twizz = await databaseService.twizzs.findOne({ _id: new ObjectId(value) })
            if (!twizz) {
              throw new ErrorWithStatus({
                message: TWIZZ_MESSAGES.TWIZZ_NOT_EXISTS,
                status: HTTP_STATUS.NOT_FOUND
              })
            }
            return true
          }
        }
      }
    },
    ['params', 'body']
  )
)
