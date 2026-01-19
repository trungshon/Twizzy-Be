import User from '~/models/schemas/User.schema'
import databaseService from './database.services'
import { RegisterReqBody, UpdateMeReqBody } from '~/models/requests/User.requests'
import { hashPassword } from '~/utils/crypto'
import { signToken, verifyToken } from '~/utils/jwt'
import { TokenType, UserVerifyStatus } from '~/constants/enum'
import RefreshToken from '~/models/schemas/RefreshToken.schema'
import { ObjectId } from 'mongodb'
import { config } from 'dotenv'
import { USER_MESSAGES } from '~/constants/messages'
import { generateOTP, getOTPExpiration } from '~/utils/otp'
import emailService from './email.services'
import { generateUsername } from '~/utils/username'
import Follower from '~/models/schemas/Follower.schema'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { ErrorWithStatus } from '~/models/Errors'
import axios from 'axios'
config()

class UsersService {
  private signAccessToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: { user_id, token_type: TokenType.AccessToken, verify },
      privateKey: process.env.JWT_SECRET_ACCESS_TOKEN as string,
      options: { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN as unknown as number }
    })
  }

  private signRefreshToken({ user_id, verify, exp }: { user_id: string; verify: UserVerifyStatus; exp?: number }) {
    if (exp) {
      return signToken({
        payload: { user_id, token_type: TokenType.RefreshToken, verify, exp },
        privateKey: process.env.JWT_SECRET_REFRESH_TOKEN as string
      })
    }
    return signToken({
      payload: { user_id, token_type: TokenType.RefreshToken, verify },
      privateKey: process.env.JWT_SECRET_REFRESH_TOKEN as string,
      options: { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN as unknown as number }
    })
  }

  private signAccessTokenAndRefreshToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return Promise.all([this.signAccessToken({ user_id, verify }), this.signRefreshToken({ user_id, verify })])
  }

  private signEmailVerifyToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: { user_id, token_type: TokenType.EmailVerifyToken, verify },
      privateKey: process.env.JWT_SECRET_EMAIL_VERIFY_TOKEN as string,
      options: { expiresIn: process.env.EMAIL_VERIFY_TOKEN_EXPRIRES_IN as unknown as number }
    })
  }

  private signForgotPasswordToken({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    return signToken({
      payload: { user_id, token_type: TokenType.ForgotPasswordToken, verify },
      privateKey: process.env.JWT_SECRET_FORGOT_PASSWORD_TOKEN as string,
      options: { expiresIn: process.env.FORGOT_PASSWORD_TOKEN_EXPRIRES_IN as unknown as number }
    })
  }

  private decodeRefreshToken(refresh_token: string) {
    return verifyToken({ token: refresh_token, secretOrPublicKey: process.env.JWT_SECRET_REFRESH_TOKEN as string })
  }

  async register(payload: RegisterReqBody) {
    const user_id = new ObjectId()
    const email_verify_otp = generateOTP(6)
    const email_verify_otp_expires_at = getOTPExpiration(10)
    const hashedPassword = await hashPassword(payload.password)

    // Auto-generate username if not provided
    const username = await generateUsername(payload.name, payload.email)

    await databaseService.users.insertOne(
      new User({
        ...payload,
        _id: user_id,
        username: username,
        email_verify_otp: email_verify_otp,
        email_verify_otp_expires_at: email_verify_otp_expires_at,
        date_of_birth: new Date(payload.date_of_birth),
        password: hashedPassword
      })
    )
    // Send OTP email
    console.log(`[DEBUG] About to send verification OTP to ${payload.email}`)
    await emailService.sendEmailVerificationOTP(payload.email, email_verify_otp)
    console.log(`[DEBUG] Verification OTP sent successfully to ${payload.email}`)
    const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken({
      user_id: user_id.toString(),
      verify: UserVerifyStatus.Unverified
    })
    const { iat, exp } = await this.decodeRefreshToken(refresh_token)
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: refresh_token, user_id: new ObjectId(user_id), iat: iat as number, exp: exp as number })
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

  async login({ user_id, verify }: { user_id: string; verify: UserVerifyStatus }) {
    const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken({
      user_id,
      verify
    })
    const { iat, exp } = await this.decodeRefreshToken(refresh_token)
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: refresh_token, user_id: new ObjectId(user_id), iat: iat as number, exp: exp as number })
    )
    return {
      access_token,
      refresh_token
    }
  }

  private async getGoogleUserInfo(access_token: string, id_token: string) {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
      params: {
        access_token,
        alt: 'json'
      },
      headers: {
        Authorization: `Bearer ${id_token}`
      }
    })
    return data as {
      id: string
      email: string
      verified_email: boolean
      name: string
      given_name: string
      family_name: string
      picture: string
      locale: string
    }
  }

  // Verify Google ID token from mobile app
  private async verifyGoogleIdToken(idToken: string) {
    const { data } = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`)
    return data as {
      iss: string
      azp: string
      aud: string
      sub: string
      email: string
      email_verified: string
      name: string
      picture: string
      given_name: string
      family_name: string
      iat: string
      exp: string
    }
  }

  private async getOAuthGoogleToken(code: string) {
    const body = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code'
    }
    const { data } = await axios.post('https://oauth2.googleapis.com/token', body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })
    return data as { access_token: string; id_token: string }
  }

  async oauth(code: string) {
    const { id_token, access_token } = await this.getOAuthGoogleToken(code)
    const userInfo = await this.getGoogleUserInfo(access_token, id_token)
    if (!userInfo.verified_email) {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.GMAIL_NOT_VERIFIED,
        status: HTTP_STATUS.BAD_REQUEST
      })
    }
    const user = await databaseService.users.findOne({ email: userInfo.email })
    // Nếu tồn tại thì cho login vào
    if (user) {
      const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken({
        user_id: user._id.toString(),
        verify: user.verify
      })
      const { iat, exp } = await this.decodeRefreshToken(refresh_token)
      await databaseService.refreshTokens.insertOne(
        new RefreshToken({ token: refresh_token, user_id: user._id, iat: iat as number, exp: exp as number })
      )
      return {
        access_token,
        refresh_token,
        newUser: 0,
        verify: user.verify
      }
    } else {
      const password = Math.random().toString(36).substring(2, 15)
      // không thì đăng ký
      const data = await this.register({
        email: userInfo.email,
        name: userInfo.name,
        date_of_birth: new Date().toISOString(),
        password: password,
        confirm_password: password
      })
      return {
        ...data,
        newUser: 1,
        verify: UserVerifyStatus.Unverified
      }
    }
  }

  // OAuth for mobile apps using ID token
  async oauthMobile(idToken: string) {
    const tokenInfo = await this.verifyGoogleIdToken(idToken)

    // Check email verified
    if (tokenInfo.email_verified !== 'true') {
      throw new ErrorWithStatus({
        message: USER_MESSAGES.GMAIL_NOT_VERIFIED,
        status: HTTP_STATUS.BAD_REQUEST
      })
    }

    const user = await databaseService.users.findOne({ email: tokenInfo.email })

    // Nếu user đã tồn tại thì login
    if (user) {
      const [access_token, refresh_token] = await this.signAccessTokenAndRefreshToken({
        user_id: user._id.toString(),
        verify: user.verify
      })
      const { iat, exp } = await this.decodeRefreshToken(refresh_token)
      await databaseService.refreshTokens.insertOne(
        new RefreshToken({ token: refresh_token, user_id: user._id, iat: iat as number, exp: exp as number })
      )
      return {
        access_token,
        refresh_token,
        newUser: 0,
        verify: user.verify
      }
    } else {
      // Tạo password ngẫu nhiên cho user đăng ký bằng Google
      const password = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

      // Đăng ký user mới
      const data = await this.register({
        email: tokenInfo.email,
        name: tokenInfo.name || tokenInfo.email.split('@')[0],
        date_of_birth: new Date().toISOString(),
        password: password,
        confirm_password: password
      })

      // Update avatar if available
      if (tokenInfo.picture) {
        await databaseService.users.updateOne(
          { email: tokenInfo.email },
          { $set: { avatar: tokenInfo.picture }, $currentDate: { updated_at: true } }
        )
      }

      return {
        ...data,
        newUser: 1,
        verify: UserVerifyStatus.Unverified
      }
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
      this.signAccessTokenAndRefreshToken({ user_id, verify: UserVerifyStatus.Verified }),
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
    const { iat, exp } = await this.decodeRefreshToken(refresh_token)
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({ token: refresh_token, user_id: new ObjectId(user_id), iat: iat as number, exp: exp as number })
    )
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
    console.log(`[DEBUG] About to send verification OTP to ${user.email}`)
    await emailService.sendEmailVerificationOTP(user.email, email_verify_otp)
    console.log(`[DEBUG] Verification OTP sent successfully to ${user.email}`)
    return { message: USER_MESSAGES.RESEND_VERIFY_EMAIL_SUCCESSFULLY }
  }

  async refreshToken(
    { user_id, verify, exp }: { user_id: string; verify: UserVerifyStatus; exp: number },
    refresh_token: string
  ) {
    // Xóa refresh token cũ
    await databaseService.refreshTokens.deleteOne({ token: refresh_token })
    // Tạo access token và refresh token mới
    const [new_access_token, new_refresh_token] = await Promise.all([
      this.signAccessToken({ user_id, verify }),
      this.signRefreshToken({ user_id, verify, exp })
    ])
    const decoded_refresh_token = await this.decodeRefreshToken(new_refresh_token)
    // Lưu refresh token mới vào DB
    await databaseService.refreshTokens.insertOne(
      new RefreshToken({
        token: new_refresh_token,
        user_id: new ObjectId(user_id),
        iat: decoded_refresh_token.iat as number,
        exp: decoded_refresh_token.exp as number
      })
    )
    return {
      access_token: new_access_token,
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
    console.log(`[DEBUG] About to send forgot password OTP to ${user.email}`)
    await emailService.sendForgotPasswordOTP(user.email, forgot_password_otp)
    console.log(`[DEBUG] Forgot password OTP sent successfully to ${user.email}`)
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
    if (!user) return null

    // Count followers (người theo dõi tôi)
    const followersCount = await databaseService.followers.countDocuments({
      followed_user_id: new ObjectId(user_id)
    })

    // Count following (tôi đang theo dõi)
    const followingCount = await databaseService.followers.countDocuments({
      user_id: new ObjectId(user_id)
    })

    return {
      ...user,
      followers_count: followersCount,
      following_count: followingCount
    }
  }

  async getProfileByUsername(username: string, current_user_id: string) {
    const user = await databaseService.users.findOne(
      { username },
      {
        projection: {
          password: 0,
          email: 0,
          email_verify_token: 0,
          forgot_password_token: 0,
          email_verify_otp: 0,
          forgot_password_otp: 0,
          email_verify_otp_expires_at: 0,
          forgot_password_otp_expires_at: 0
        }
      }
    )

    if (!user) return null

    const is_following = await databaseService.followers.findOne({
      user_id: new ObjectId(current_user_id),
      followed_user_id: user._id
    })

    const followersCount = await databaseService.followers.countDocuments({
        followed_user_id: user._id
    })

    const followingCount = await databaseService.followers.countDocuments({
      user_id: user._id
    })

    return {
      ...user,
      is_following: Boolean(is_following),
      followers_count: followersCount,
      following_count: followingCount
    }
  }

  async updateMe(user_id: string, payload: UpdateMeReqBody) {
    const _payload = payload.date_of_birth ? { ...payload, date_of_birth: new Date(payload.date_of_birth) } : payload
    const userUpdate: any = { ...(_payload as UpdateMeReqBody & { date_of_birth?: Date }) }

    // Logic username
    if (payload.username) {
      const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })
      if (user?.username_changed) {
        throw new ErrorWithStatus({
          message: USER_MESSAGES.USERNAME_CAN_ONLY_BE_CHANGED_ONCE,
          status: HTTP_STATUS.FORBIDDEN
        })
      }
      userUpdate.username_changed = true
    }

    const user = await databaseService.users.findOneAndUpdate(
      { _id: new ObjectId(user_id) },
      {
        $set: userUpdate,
        $currentDate: { updated_at: true }
      },
      {
        returnDocument: 'after',
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
  async follow(user_id: string, followed_user_id: string) {
    const follower = await databaseService.followers.findOne({
      user_id: new ObjectId(user_id),
      followed_user_id: new ObjectId(followed_user_id)
    })
    if (follower === null) {
      await databaseService.followers.insertOne(
        new Follower({
          user_id: new ObjectId(user_id),
          followed_user_id: new ObjectId(followed_user_id)
        })
      )
      return { message: USER_MESSAGES.FOLLOW_SUCCESSFULLY }
    }
    return { message: USER_MESSAGES.FOLLOWED_ALREADY }
  }
  async unfollow(user_id: string, followed_user_id: string) {
    const follower = await databaseService.followers.findOne({
      user_id: new ObjectId(user_id),
      followed_user_id: new ObjectId(followed_user_id)
    })
    if (follower === null) {
      return { message: USER_MESSAGES.ALREADY_UNFOLLOWED }
    }
    await databaseService.followers.deleteOne({
      user_id: new ObjectId(user_id),
      followed_user_id: new ObjectId(followed_user_id)
    })
    return { message: USER_MESSAGES.UNFOLLOW_SUCCESSFULLY }
  }

  async changePassword(user_id: string, password: string) {
    const hashedPassword = await hashPassword(password)
    await databaseService.users.updateOne(
      { _id: new ObjectId(user_id) },
      { $set: { password: hashedPassword }, $currentDate: { updated_at: true } }
    )
    return { message: USER_MESSAGES.CHANGE_PASSWORD_SUCCESSFULLY }
  }

  async getFollowers({
    user_id,
    limit,
    page,
    current_user_id
  }: {
    user_id: string
    limit: number
    page: number
    current_user_id: string
  }) {
    const followers = await databaseService.followers
      .aggregate([
        {
          $match: {
            followed_user_id: new ObjectId(user_id),
            user_id: { $ne: new ObjectId(current_user_id) }
          }
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
          $unwind: '$user'
        },
        {
          $lookup: {
            from: 'followers',
            let: { user_id: '$user._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$user_id', new ObjectId(current_user_id)] },
                      { $eq: ['$followed_user_id', '$$user_id'] }
                    ]
                  }
                }
              }
            ],
            as: 'is_following'
          }
        },
        {
          $project: {
            _id: 0,
            user: {
              _id: 1,
              name: 1,
              username: 1,
              avatar: 1,
              bio: 1,
              verify: 1
            },
            is_following: {
              $gt: [{ $size: '$is_following' }, 0]
            }
          }
        },
        {
          $addFields: {
            'user.is_following': '$is_following'
          }
        },
        {
          $replaceRoot: { newRoot: '$user' }
        }
      ])
      .toArray()
    return followers
  }

  async getFollowing({
    user_id,
    limit,
    page,
    current_user_id
  }: {
    user_id: string
    limit: number
    page: number
    current_user_id: string
  }) {
    const following = await databaseService.followers
      .aggregate([
        {
          $match: {
            user_id: new ObjectId(user_id),
            followed_user_id: { $ne: new ObjectId(current_user_id) }
          }
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
            localField: 'followed_user_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $lookup: {
            from: 'followers',
            let: { user_id: '$user._id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$user_id', new ObjectId(current_user_id)] },
                      { $eq: ['$followed_user_id', '$$user_id'] }
                    ]
                  }
                }
              }
            ],
            as: 'is_following'
          }
        },
        {
          $project: {
            _id: 0,
            user: {
              _id: 1,
              name: 1,
              username: 1,
              avatar: 1,
              bio: 1,
              verify: 1
            },
            is_following: {
              $gt: [{ $size: '$is_following' }, 0]
            }
          }
        },
        {
          $addFields: {
            'user.is_following': '$is_following'
          }
        },
        {
          $replaceRoot: { newRoot: '$user' }
        }
      ])
      .toArray()
    return following
  }
}

const usersService = new UsersService()
export default usersService
