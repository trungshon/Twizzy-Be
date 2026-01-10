import { ObjectId } from 'mongodb'
import { UserVerifyStatus } from '~/constants/enum'

interface UserType {
  _id?: ObjectId
  name: string
  email: string
  date_of_birth: Date
  password: string
  created_at?: Date
  updated_at?: Date
  email_verify_token?: string
  forgot_password_token?: string
  verify?: UserVerifyStatus
  // OTP fields
  email_verify_otp?: string
  email_verify_otp_expires_at?: Date
  forgot_password_otp?: string
  forgot_password_otp_expires_at?: Date

  bio?: string
  location?: string
  website?: string
  username?: string
  avatar?: string
  cover_photo?: string
}

export default class User {
  _id?: ObjectId
  name: string
  email: string
  date_of_birth: Date
  password: string
  created_at: Date
  updated_at: Date
  email_verify_token: string
  forgot_password_token: string
  verify: UserVerifyStatus
  // OTP fields
  email_verify_otp: string
  email_verify_otp_expires_at: Date | null
  forgot_password_otp: string
  forgot_password_otp_expires_at: Date | null

  bio: string
  location: string
  website: string
  username: string
  avatar: string
  cover_photo: string

  constructor(user: UserType) {
    const date = new Date()
    this._id = user._id
    this.name = user.name || ''
    this.email = user.email
    this.date_of_birth = user.date_of_birth || new Date()
    this.password = user.password
    this.created_at = user.created_at || date
    this.updated_at = user.updated_at || date
    this.email_verify_token = user.email_verify_token || ''
    this.forgot_password_token = user.forgot_password_token || ''
    this.verify = user.verify || UserVerifyStatus.Unverified
    // OTP fields
    this.email_verify_otp = user.email_verify_otp || ''
    this.email_verify_otp_expires_at = user.email_verify_otp_expires_at || null
    this.forgot_password_otp = user.forgot_password_otp || ''
    this.forgot_password_otp_expires_at = user.forgot_password_otp_expires_at || null
    this.bio = user.bio || ''
    this.location = user.location || ''
    this.website = user.website || ''
    this.username = user.username || ''
    this.avatar = user.avatar || ''
    this.cover_photo = user.cover_photo || ''
  }
}
