import User from '~/models/schemas/User.schema'
import databaseService from './database.services'
import { RegisterReqBody } from '~/models/requests/User.requests'
import { hashPassword } from '~/utils/crypto'
import { signToken } from '~/utils/jwt'
import { TokenType, UserVerifyStatus } from '~/constants/enum'
import RefreshToken from '~/models/schemas/RefreshToken.schema'
import { ObjectId } from 'mongodb'
import { config } from 'dotenv'
import { USER_MESSAGES } from '~/constants/messages'
import { generateOTP, getOTPExpiration } from '~/utils/otp'
import emailService from './email.services'
config()

class UsersService {
  private signAccessToken(user_id: string) {
    return signToken({
      payload: { user_id, token_type: TokenType.AccessToken },
      privateKey: process.env.JWT_SECRET_ACCESS_TOKEN as string,
      options: { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as unknown as number }
    })
  }

  private signRefreshToken(user_id: string) {
    return signToken({
      payload: { user_id, token_type: TokenType.RefreshToken },
      privateKey: process.env.JWT_SECRET_REFRESH_TOKEN as string,
      options: { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN as unknown as number }
    })
  }

  private signAccessTokenAndRefreshToken(user_id: string) {
    return Promise.all([this.signAccessToken(user_id), this.signRefreshToken(user_id)])
  }

  private signEmailVerifyToken(user_id: string) {
    return signToken({
      payload: { user_id, token_type: TokenType.EmailVerifyToken },
      privateKey: process.env.JWT_SECRET_EMAIL_VERIFY_TOKEN as string,
      options: { expiresIn: process.env.EMAIL_VERIFY_TOKEN_EXPRIRES_IN as unknown as number }
    })
  }

  private signForgotPasswordToken(user_id: string) {
    return signToken({
      payload: { user_id, token_type: TokenType.ForgotPasswordToken },
      privateKey: process.env.JWT_SECRET_FORGOT_PASSWORD_TOKEN as string,
      options: { expiresIn: process.env.FORGOT_PASSWORD_TOKEN_EXPRIRES_IN as unknown as number }
    })
  }

  async register(payload: RegisterReqBody) {
    const user_id = new ObjectId()
    const email_verify_otp = generateOTP(6)
    const email_verify_otp_expires_at = getOTPExpiration(10)
    const hashedPassword = await hashPassword(payload.password)
    await databaseService.users.insertOne(
      new User({
        ...payload,
        _id: user_id,
        email_verify_otp: email_verify_otp,
        email_verify_otp_expires_at: email_verify_otp_expires_at,
        date_of_birth: new Date(payload.date_of_birth),
        password: hashedPassword
      })
    )
    // Send OTP email
    await emailService.sendEmailVerificationOTP(payload.email, email_verify_otp)
    const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken(user_id.toString())
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: refresh_token, user_id: new ObjectId(user_id) })
    )
    return {
      access_token,
      refresh_token
    }
  }

  async checkEmailExist(email: string) {
    const user = await databaseService.users.findOne({ email })
    return Boolean(user)
  }

  async login(user_id: string) {
    const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken(user_id)
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: refresh_token, user_id: new ObjectId(user_id) })
    )
    return {
      access_token,
      refresh_token
    }
  }

  async logout(refresh_token: string) {
    await databaseService.refreshTokens.deleteOne({ token: refresh_token })
    return {
      message: USER_MESSAGES.LOGOUT_SUCCESSFULLY
    }
  }

  async verifyEmail(user_id: string) {
    const [token] = await Promise.all([
      this.signAccessTokenAndRefreshToken(user_id),
      databaseService.users.updateOne(
        { _id: new ObjectId(user_id) },
        {
          $set: {
            email_verify_otp: '',
            email_verify_otp_expires_at: null,
            verify: UserVerifyStatus.Verified
          },
          $currentDate: { updated_at: true }
        }
      )
    ])
    const [access_token, refresh_token] = token
    return {
      access_token,
      refresh_token,
      message: USER_MESSAGES.EMAIL_VERIFY_SUCCESSFULLY
    }
  }

  async resendVerifyEmail(user_id: string) {
    const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })
    if (!user) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }
    const email_verify_otp = generateOTP(6)
    const email_verify_otp_expires_at = getOTPExpiration(10)
    await databaseService.users.updateOne(
      { _id: new ObjectId(user_id) },
      {
        $set: {
          email_verify_otp: email_verify_otp,
          email_verify_otp_expires_at: email_verify_otp_expires_at
        },
        $currentDate: { updated_at: true }
      }
    )
    // Send OTP email
    await emailService.sendEmailVerificationOTP(user.email, email_verify_otp)
    return { message: USER_MESSAGES.RESEND_VERIFY_EMAIL_SUCCESSFULLY }
  }

  async refreshToken(user_id: string, refresh_token: string) {
    // Xóa refresh token cũ
    await databaseService.refreshTokens.deleteOne({ token: refresh_token })
    // Tạo access token và refresh token mới
    const [access_token, new_refresh_token] = await this.signAccessTokenAndRefreshToken(user_id)
    // Lưu refresh token mới vào DB
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: new_refresh_token, user_id: new ObjectId(user_id) })
    )
    return {
      access_token,
      refresh_token: new_refresh_token
    }
  }

  async forgotPassword(user_id: string) {
    const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })
    if (!user) {
      throw new Error(USER_MESSAGES.USER_NOT_FOUND)
    }
    const forgot_password_otp = generateOTP(6)
    const forgot_password_otp_expires_at = getOTPExpiration(10)
    await databaseService.users.updateOne(
      { _id: new ObjectId(user_id) },
      {
        $set: {
          forgot_password_otp: forgot_password_otp,
          forgot_password_otp_expires_at: forgot_password_otp_expires_at
        },
        $currentDate: { updated_at: true }
      }
    )
    // Send OTP email
    await emailService.sendForgotPasswordOTP(user.email, forgot_password_otp)
    return { message: USER_MESSAGES.CHECK_EMAIL_FOR_RESET_PASSWORD }
  }

  async resetPassword(user_id: string, password: string) {
    const hashedPassword = await hashPassword(password)
    await databaseService.users.updateOne(
      { _id: new ObjectId(user_id) },
      {
        $set: {
          password: hashedPassword,
          forgot_password_otp: '',
          forgot_password_otp_expires_at: null
        },
        $currentDate: { updated_at: true }
      }
    )
    return { message: USER_MESSAGES.RESET_PASSWORD_SUCCESSFULLY }
  }

  async getMe(user_id: string) {
    const user = await databaseService.users.findOne(
      { _id: new ObjectId(user_id) },
      {
        projection: {
          password: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          email_verify_otp: 0,
          forgot_password_otp: 0,
          email_verify_otp_expires_at: 0,
          forgot_password_otp_expires_at: 0
        }
      }
    )
    return user
  }
}

const usersService = new UsersService()
export default usersService
