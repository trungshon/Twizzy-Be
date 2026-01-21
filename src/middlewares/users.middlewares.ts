import { checkSchema } from 'express-validator'
import validate from '../utils/validation'
import usersService from '~/services/users.services'
import { USER_MESSAGES } from '~/constants/messages'
import databaseService from '~/services/database.services'
import { verifyPassword } from '~/utils/crypto'
import { verifyToken } from '~/utils/jwt'
import { ErrorWithStatus } from '~/models/Errors'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { JsonWebTokenError } from 'jsonwebtoken'
import { capitalize } from 'lodash'
import { NextFunction, Request, Response } from 'express'
import { TokenType, UserVerifyStatus } from '~/constants/enum'
import { ObjectId } from 'mongodb'
import { ParamSchema } from 'express-validator/lib/middlewares/schema'
import { isOTPExpired } from '~/utils/otp'
import { TokenPayload } from '~/models/requests/User.requests'
import { REGEX_USERNAME } from '~/constants/regex'

const nameSchema: ParamSchema = {
  isString: {
    errorMessage: USER_MESSAGES.NAME_MUST_BE_A_STRING
  },
  notEmpty: {
    errorMessage: USER_MESSAGES.NAME_IS_REQUIRED
  },
  isLength: {
    options: { min: 1, max: 100 },
    errorMessage: USER_MESSAGES.NAME_MUST_BE_FROM_1_TO_100_CHARACTERS
  },
  trim: true
}
const dateOfBirthSchema: ParamSchema = {
  isISO8601: {
    errorMessage: USER_MESSAGES.DATE_OF_BIRTH_MUST_BE_ISO8601,
    options: {
      strict: true,
      strictSeparator: true
    }
  }
}
const imageUrlSchema: ParamSchema = {
  optional: true,
  isString: {
    errorMessage: USER_MESSAGES.IMAGE_URL_MUST_BE_A_STRING
  },
  trim: true,
  isLength: {
    options: { min: 1, max: 400 },
    errorMessage: USER_MESSAGES.IMAGE_URL_MUST_BE_FROM_1_TO_400_CHARACTERS
  }
}

const passwordSchema: ParamSchema = {
  isString: {
    errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_A_STRING
  },
  notEmpty: {
    errorMessage: USER_MESSAGES.PASSWORD_IS_REQUIRED
  },
  isLength: {
    options: { min: 6, max: 50 },
    errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_FROM_6_TO_50_CHARACTERS
  },
  isStrongPassword: {
    errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_STRONG,
    options: {
      minLength: 6,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    }
  }
}
const confirmPasswordSchema: ParamSchema = {
  isString: {
    errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_MUST_BE_A_STRING
  },
  notEmpty: {
    errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_IS_REQUIRED
  },
  isLength: {
    options: { min: 6, max: 50 },
    errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_MUST_BE_FROM_6_TO_50_CHARACTERS
  },
  isStrongPassword: {
    errorMessage: USER_MESSAGES.CONFIRM_PASSWORD_MUST_BE_STRONG,
    options: {
      minLength: 6,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    }
  },
  custom: {
    options: (value, { req }) => {
      if (value !== req.body.password) {
        throw new Error(USER_MESSAGES.CONFIRM_PASSWORD_MUST_BE_THE_SAME)
      }
      return true
    }
  }
}

const forgotPasswordOTPSchema: ParamSchema = {
  trim: true,
  isString: {
    errorMessage: USER_MESSAGES.OTP_MUST_BE_A_STRING
  },
  notEmpty: {
    errorMessage: USER_MESSAGES.OTP_IS_REQUIRED
  },
  isLength: {
    options: { min: 6, max: 6 },
    errorMessage: USER_MESSAGES.OTP_MUST_BE_6_DIGITS
  },
  custom: {
    options: async (value: string, { req }) => {
      if (!value) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.OTP_IS_REQUIRED,
          status: HTTP_STATUS.UNAUTHORIZED
        })
      }
      // Find user by email from request
      const email = req.body.email || (req.user as any)?.email
      if (!email) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.EMAIL_IS_REQUIRED,
          status: HTTP_STATUS.BAD_REQUEST
        })
      }
      const user = await databaseService.users.findOne({ email })
      if (!user) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.USER_NOT_FOUND,
          status: HTTP_STATUS.NOT_FOUND
        })
      }
      // Check if OTP matches
      if (user.forgot_password_otp !== value) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.OTP_IS_INVALID,
          status: HTTP_STATUS.UNAUTHORIZED
        })
      }
      // Check if OTP is expired
      if (!user.forgot_password_otp_expires_at || isOTPExpired(user.forgot_password_otp_expires_at)) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.OTP_EXPIRED,
          status: HTTP_STATUS.UNAUTHORIZED
        })
      }
      // Store user_id in request for controller
      ;(req as Request).decoded_forgot_password_otp = {
        user_id: user._id?.toString() || '',
        token_type: TokenType.ForgotPasswordToken
      }
      return true
    }
  }
}

const userIdSchema: ParamSchema = {
  custom: {
    options: async (value, { req }) => {
      if (!ObjectId.isValid(value)) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.INVALID_USER_ID,
          status: HTTP_STATUS.NOT_FOUND
        })
      }
      const followed_user = await databaseService.users.findOne({ _id: new ObjectId(value) })
      if (followed_user === null) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.USER_NOT_FOUND,
          status: HTTP_STATUS.NOT_FOUND
        })
      }
      return true
    }
  }
}

export const loginValidator = validate(
  checkSchema(
    {
      email: {
        notEmpty: {
          errorMessage: USER_MESSAGES.EMAIL_IS_REQUIRED
        },
        isEmail: {
          errorMessage: USER_MESSAGES.EMAIL_MUST_BE_A_VALID_EMAIL
        },
        trim: true,
        custom: {
          options: async (value, { req }) => {
            // Tìm user theo email
            const user = await databaseService.users.findOne({ email: value })

            // Không tồn tại user
            if (!user) {
              throw new Error(USER_MESSAGES.EMAIL_OR_PASSWORD_IS_INCORRECT)
            }

            // So sánh mật khẩu người dùng nhập với hash trong DB bằng bcrypt
            const isMatch = await verifyPassword(req.body.password, user.password)

            if (!isMatch) {
              // Trả về lỗi chung để không lộ là email hay password sai
              throw new Error(USER_MESSAGES.EMAIL_OR_PASSWORD_IS_INCORRECT)
            }

            // Lưu user vào request để controller dùng
            req.user = user
            return true
          }
        }
      },
      password: {
        isString: {
          errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_A_STRING
        },
        notEmpty: {
          errorMessage: USER_MESSAGES.PASSWORD_IS_REQUIRED
        },
        isLength: {
          options: { min: 6, max: 50 },
          errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_FROM_6_TO_50_CHARACTERS
        },
        isStrongPassword: {
          errorMessage: USER_MESSAGES.PASSWORD_MUST_BE_STRONG,
          options: {
            minLength: 6,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 1
          }
        }
      }
    },
    ['body']
  )
)

export const registerValidator = validate(
  checkSchema(
    {
      name: nameSchema,
      email: {
        notEmpty: {
          errorMessage: USER_MESSAGES.EMAIL_IS_REQUIRED
        },
        isEmail: {
          errorMessage: USER_MESSAGES.EMAIL_MUST_BE_A_VALID_EMAIL
        },
        trim: true,
        custom: {
          options: async (value) => {
            const isExist = await usersService.checkEmailExist(value)
            if (isExist) {
              throw new Error(USER_MESSAGES.EMAIL_ALREADY_EXISTS)
            }
            return true
          }
        }
      },
      password: passwordSchema,
      confirm_password: confirmPasswordSchema,
      date_of_birth: dateOfBirthSchema
    },
    ['body']
  )
)

export const accessTokenValidator = validate(
  checkSchema(
    {
      Authorization: {
        custom: {
          options: async (value: string, { req }) => {
            const access_token = (value || '').split(' ')[1]
            if (!access_token) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.ACCESS_TOKEN_IS_REQUIRED,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            try {
              const decoded_authorization = await verifyToken({
                token: access_token,
                secretOrPublicKey: process.env.JWT_SECRET_ACCESS_TOKEN as string
              })
              ;(req as Request).decoded_authorization = decoded_authorization
            } catch (error) {
              throw new ErrorWithStatus({
                message: capitalize((error as JsonWebTokenError).message),
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            return true
          }
        }
      }
    },
    ['headers']
  )
)

export const refreshTokenValidator = validate(
  checkSchema(
    {
      refresh_token: {
        trim: true,
        custom: {
          options: async (value: string, { req }) => {
            if (!value) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.REFRESH_TOKEN_IS_REQUIRED,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            try {
              const [decoded_refresh_token, refresh_token] = await Promise.all([
                verifyToken({ token: value, secretOrPublicKey: process.env.JWT_SECRET_REFRESH_TOKEN as string }),
                databaseService.refreshTokens.findOne({ token: value })
              ])
              if (refresh_token === null) {
                throw new ErrorWithStatus({
                  message: USER_MESSAGES.USED_REFRESH_TOKEN_OR_NOT_EXISTS,
                  status: HTTP_STATUS.UNAUTHORIZED
                })
              }
              ;(req as Request).decoded_refresh_token = decoded_refresh_token
              const user = await databaseService.users.findOne({ _id: new ObjectId(decoded_refresh_token.user_id) })
              if (!user) {
                throw new ErrorWithStatus({
                  message: USER_MESSAGES.USER_NOT_FOUND,
                  status: HTTP_STATUS.NOT_FOUND
                })
              }
              ;(req as Request).user = user
            } catch (error) {
              if (error instanceof JsonWebTokenError) {
                throw new ErrorWithStatus({
                  message: capitalize(error.message),
                  status: HTTP_STATUS.UNAUTHORIZED
                })
              }
              throw error
            }
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const emailVerifyOTPValidator = validate(
  checkSchema(
    {
      email_verify_otp: {
        trim: true,
        isString: {
          errorMessage: USER_MESSAGES.OTP_MUST_BE_A_STRING
        },
        notEmpty: {
          errorMessage: USER_MESSAGES.OTP_IS_REQUIRED
        },
        isLength: {
          options: { min: 6, max: 6 },
          errorMessage: USER_MESSAGES.OTP_MUST_BE_6_DIGITS
        },
        custom: {
          options: async (value: string, { req }) => {
            if (!value) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.OTP_IS_REQUIRED,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            // Find user by email from request (should be set in previous middleware or body)
            const email = req.body.email || (req.user as any)?.email
            if (!email) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.EMAIL_IS_REQUIRED,
                status: HTTP_STATUS.BAD_REQUEST
              })
            }
            const user = await databaseService.users.findOne({ email })
            if (!user) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.USER_NOT_FOUND,
                status: HTTP_STATUS.NOT_FOUND
              })
            }
            // Check if OTP matches
            if (user.email_verify_otp !== value) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.OTP_IS_INVALID,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            // Check if OTP is expired
            if (!user.email_verify_otp_expires_at || isOTPExpired(user.email_verify_otp_expires_at)) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.OTP_EXPIRED,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
            // Store user_id in request for controller
            ;(req as Request).decoded_email_verify_otp = {
              user_id: user._id?.toString() || '',
              token_type: TokenType.EmailVerifyToken
            }
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const forgotPasswordValidator = validate(
  checkSchema(
    {
      email: {
        notEmpty: {
          errorMessage: USER_MESSAGES.EMAIL_IS_REQUIRED
        },
        isEmail: {
          errorMessage: USER_MESSAGES.EMAIL_MUST_BE_A_VALID_EMAIL
        },
        trim: true,
        custom: {
          options: async (value, { req }) => {
            const user = await databaseService.users.findOne({ email: value })
            if (user === null) {
              throw new Error(USER_MESSAGES.USER_NOT_FOUND)
            }
            req.user = user
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const verifyForgotPasswordOTPValidator = validate(
  checkSchema(
    {
      forgot_password_otp: forgotPasswordOTPSchema
    },
    ['body']
  )
)

export const resetPasswordValidator = validate(
  checkSchema(
    {
      forgot_password_otp: forgotPasswordOTPSchema,
      password: passwordSchema,
      confirm_password: confirmPasswordSchema
    },
    ['body']
  )
)

export const verifiedUserValidator = (req: Request, res: Response, next: NextFunction) => {
  const { verify } = req.decoded_authorization as TokenPayload
  if (verify !== UserVerifyStatus.Verified) {
    return next(
      new ErrorWithStatus({
        message: USER_MESSAGES.USER_NOT_VERIFIED,
        status: HTTP_STATUS.FORBIDDEN
      })
    )
  }
  next()
}

export const updateMeValidator = validate(
  checkSchema(
    {
      name: {
        ...nameSchema,
        optional: true,
        notEmpty: undefined
      },
      date_of_birth: {
        ...dateOfBirthSchema,
        optional: true
      },
      bio: {
        optional: true,
        isString: {
          errorMessage: USER_MESSAGES.BIO_MUST_BE_A_STRING
        },
        trim: true,
        isLength: {
          options: { min: 1, max: 200 },
          errorMessage: USER_MESSAGES.BIO_MUST_BE_FROM_1_TO_200_CHARACTERS
        }
      },
      location: {
        optional: true,
        isString: {
          errorMessage: USER_MESSAGES.LOCATION_MUST_BE_A_STRING
        },
        trim: true,
        isLength: {
          options: { min: 1, max: 200 },
          errorMessage: USER_MESSAGES.LOCATION_MUST_BE_FROM_1_TO_200_CHARACTERS
        }
      },
      website: {
        optional: true,
        isString: {
          errorMessage: USER_MESSAGES.WEBSITE_MUST_BE_A_STRING
        },
        trim: true,
        isLength: {
          options: { min: 1, max: 200 },
          errorMessage: USER_MESSAGES.WEBSITE_MUST_BE_FROM_1_TO_200_CHARACTERS
        }
      },
      username: {
        optional: true,
        isString: {
          errorMessage: USER_MESSAGES.USERNAME_MUST_BE_A_STRING
        },
        trim: true,
        custom: {
          options: async (value: string, { req }) => {
            if (!REGEX_USERNAME.test(value)) {
              throw new Error(USER_MESSAGES.USERNAME_INVALID)
            }
            const user = await databaseService.users.findOne({ username: value })
            // Nếu username đã tồn tại và không phải của chính user đang update thì báo lỗi
            if (user && user._id.toString() !== (req as any).decoded_authorization.user_id) {
              throw new Error(USER_MESSAGES.USERNAME_EXISTED)
            }
          }
        }
      },
      avatar: imageUrlSchema,
      cover_photo: imageUrlSchema,
      twizz_circle: {
        optional: true,
        isArray: {
          errorMessage: 'Twizz circle must be an array'
        },
        custom: {
          options: (value: string[]) => {
            if (!value) return true
            // Validate each ID is a valid ObjectId string
            for (const id of value) {
              if (!ObjectId.isValid(id)) {
                throw new Error(`Invalid user ID: ${id}`)
              }
            }
            return true
          }
        }
      }
    },
    ['body']
  )
)

export const followValidator = validate(
  checkSchema(
    {
      followed_user_id: userIdSchema
    },
    ['body']
  )
)

export const unfollowValidator = validate(
  checkSchema(
    {
      user_id: userIdSchema
    },
    ['params']
  )
)

export const changePasswordValidator = validate(
  checkSchema(
    {
      old_password: {
        ...passwordSchema,
        custom: {
          options: async (value: string, { req }) => {
            const { user_id } = req.decoded_authorization as TokenPayload
            const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })
            if (!user) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.USER_NOT_FOUND,
                status: HTTP_STATUS.NOT_FOUND
              })
            }
            const { password } = user
            const isMatch = await verifyPassword(value, password)
            if (!isMatch) {
              throw new ErrorWithStatus({
                message: USER_MESSAGES.OLD_PASSWORD_IS_INCORRECT,
                status: HTTP_STATUS.UNAUTHORIZED
              })
            }
          }
        }
      },
      password: {
        ...passwordSchema,
        custom: {
          options: (value: string, { req }) => {
            // Check if new password is different from old password
            if (value === req.body.old_password) {
              throw new Error(USER_MESSAGES.NEW_PASSWORD_MUST_BE_DIFFERENT)
            }
            return true
          }
        }
      },
      confirm_password: confirmPasswordSchema
    },
    ['body']
  )
)

// Google OAuth Mobile validator (validates ID token from mobile app)
export const googleOAuthMobileValidator = validate(
  checkSchema(
    {
      id_token: {
        notEmpty: {
          errorMessage: USER_MESSAGES.GOOGLE_ID_TOKEN_IS_REQUIRED
        },
        isString: {
          errorMessage: USER_MESSAGES.GOOGLE_ID_TOKEN_IS_INVALID
        },
        trim: true
      }
    },
    ['body']
  )
)

export const isUserLoggedInValidator = (middleware: (req: Request, res: Response, next: NextFunction) => void) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      return middleware(req, res, next)
    }
    next()
  }
}
