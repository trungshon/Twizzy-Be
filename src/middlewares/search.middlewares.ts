import { checkSchema } from 'express-validator'
import { SEARCH_MESSAGES } from '~/constants/messages'
import validate from '~/utils/validation'
import { MediaTypeQuery, PeopleFollow } from '~/constants/enum'

export const searchValidator = validate(
  checkSchema(
    {
      content: {
        isString: {
          errorMessage: SEARCH_MESSAGES.CONTENT_MUST_BE_A_STRING
        }
      },
      type: {
        optional: true,
        isIn: {
          options: [['users', 'twizzs']],
          errorMessage: SEARCH_MESSAGES.SEARCH_TYPE_IS_INVALID
        }
      },
      field: {
        optional: true,
        isIn: {
          options: [['username', 'name']],
          errorMessage: SEARCH_MESSAGES.SEARCH_FIELD_IS_INVALID
        }
      },
      media_type: {
        optional: true,
        isIn: {
          options: [Object.values(MediaTypeQuery)],
          errorMessage: SEARCH_MESSAGES.MEDIA_TYPE_IS_INVALID
        }
      },
      people_follow: {
        optional: true,
        isIn: {
          options: [Object.values(PeopleFollow)],
          errorMessage: SEARCH_MESSAGES.PEOPLE_FOLLOW_IS_INVALID
        }
      }
    },
    ['query']
  )
)
