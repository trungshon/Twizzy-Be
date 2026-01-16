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
  Retwizz,
  Comment,
  QuoteTwizz
}

export enum TwizzAudience {
  Everyone,
  TwizzCircle
}

export enum PeopleFollow {
  Anyone = '0',
  Following = '1'
}