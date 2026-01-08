import { Request, Response, NextFunction } from 'express'
import { checkSchema } from 'express-validator'
import validate from '../utils/validation'
import usersService from '~/services/users.services'

export const loginValidator = (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }
  next()
}

export const registerValidator = validate(
  checkSchema({
    name: {
      isString: true,
      notEmpty: true,
      isLength: {
        options: { min: 1, max: 100 }
      },
      trim: true
    },
    email: {
      notEmpty: true,
      isEmail: true,
      trim: true,
      custom: {
        options: async (value) => {
          const isExist = await usersService.checkEmailExist(value)
          if (isExist) {
            throw new Error('Email already exists')
          }
          return true
        }
      }
    },
    password: {
      isString: true,
      notEmpty: true,
      isLength: {
        options: { min: 6, max: 50 }
      },
      isStrongPassword: {
        errorMessage:
          'Password must be at least 6 characters long and contain at least one uppercase letter, one lowercase letter, one number and one symbol',
        options: {
          minLength: 6,
          minLowercase: 1,
          minUppercase: 1,
          minNumbers: 1,
          minSymbols: 1
        }
      }
    },
    confirm_password: {
      isString: true,
      notEmpty: true,
      isLength: {
        options: { min: 6, max: 50 }
      },
      isStrongPassword: {
        errorMessage:
          'Password must be at least 6 characters long and contain at least one uppercase letter, one lowercase letter, one number and one symbol',
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
            throw new Error('Password and confirm password must be the same')
          }
          return true
        },
        errorMessage: 'Password and confirm password must be the same'
      }
    },
    date_of_birth: {
      isISO8601: {
        errorMessage: 'Invalid date of birth',
        options: {
          strict: true,
          strictSeparator: true
        }
      }
    }
  })
)
