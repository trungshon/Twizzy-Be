export enum UserVerifyStatus {
  Unverified,
  Verified,
  Banned
}

export enum TokenType {
  AccessToken,
  RefreshToken,
  ForgotPasswordToken,
  EmailVerifyToken
}

export enum MediaType {
  Image,
  Video
}

export enum MediaTypeQuery {
  Image = 'image',
  Video = 'video'
}

export enum TwizzType {
  Twizz,
  Comment,
  QuoteTwizz
}

export enum TwizzAudience {
  Everyone,
  TwizzCircle,
  OnlyMe
}

export enum PeopleFollow {
  Anyone = '0',
  Following = '1'
}

export enum NotificationType {
  Like,
  Comment,
  QuoteTwizz,
  Follow,
  Mention
}

export enum UserRole {
  User,
  Admin
}

export enum ReportReason {
  Spam,
  Harassment,
  HateSpeech,
  Violence,
  Nudity,
  Other
}

export enum ReportStatus {
  Pending,
  Resolved,
  Ignored
}