import { Router } from 'express'
import {
  accessTokenValidator,
  loginValidator,
  registerValidator,
  refreshTokenValidator,
  emailVerifyOTPValidator,
  forgotPasswordValidator,
  verifyForgotPasswordOTPValidator,
  resetPasswordValidator,
  verifiedUserValidator,
  updateMeValidator,
  followValidator,
  unfollowValidator,
  changePasswordValidator,
  googleOAuthMobileValidator
} from '../middlewares/users.middlewares'
import {
  loginController,
  registerController,
  logoutController,
  refreshTokenController,
  verifyEmailController,
  resendVerifyEmailController,
  forgotPasswordController,
  verifyForgotPasswordController,
  resetPasswordController,
  getMeController,
  updateMeController,
  getProfileController,
  followController,
  unfollowController,
  changePasswordController,
  oauthController,
  oauthMobileController,
  getFollowersController,
  getFollowingController
} from '../controllers/users.controllers'
import wrapRequestHandler from '~/utils/handlers'
import { USER_MESSAGES } from '~/constants/messages'
import { filterMiddleware } from '~/middlewares/common.middlewares'
import { UpdateMeReqBody } from '~/models/requests/User.requests'
const usersRouter = Router()

/**
 * @description Login a user
 * @path /users/login
 * @method POST
 * @body {
 *   email: string
 *   password: string
 * }
 * @response {
 *   access_token: string
 *   refresh_token: string
 * }
 */
usersRouter.post('/login', loginValidator, wrapRequestHandler(loginController))

/**
 * @description Login with Google (Web - OAuth code flow)
 * @path /users/oauth/google
 * @method GET
 * @query {
 *   code: string
 * }
 */
usersRouter.get('/oauth/google', wrapRequestHandler(oauthController))

/**
 * @description Login with Google (Mobile - ID token flow)
 * @path /users/oauth/google/mobile
 * @method POST
 * @body {
 *   id_token: string
 * }
 * @response {
 *   access_token: string
 *   refresh_token: string
 *   newUser: 0 | 1
 *   verify: UserVerifyStatus
 * }
 */
usersRouter.post('/oauth/google/mobile', googleOAuthMobileValidator, wrapRequestHandler(oauthMobileController))

/**
 * @description Register a user
 * @path /users/register
 * @method POST
 * @body {
 *   name: string
 *   email: string
 *   confirm_password: string
 *   date_of_birth: string
 *   password: string
 * }
 * @response {
 *   access_token: string
 *   refresh_token: string
 * }
 */
usersRouter.post('/register', registerValidator, wrapRequestHandler(registerController))

/**
 * @description Logout a user
 * @path /users/logout
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   refresh_token: string
 * }
 */
usersRouter.post('/logout', accessTokenValidator, refreshTokenValidator, wrapRequestHandler(logoutController))

/**
 * @description Refresh access token
 * @path /users/refresh-token
 * @method POST
 * @body {
 *   refresh_token: string
 * }
 * @response {
 *   access_token: string
 *   refresh_token: string
 * }
 */
usersRouter.post('/refresh-token', refreshTokenValidator, wrapRequestHandler(refreshTokenController))

/**
 * @description Verify email khi người dùng click vào link trong email
 * @path /users/verify-email
 * @method POST
 * @body {
 *   email: string
 *   email_verify_otp: string
 * }
 * @response {
 *   message: string
 * }
 */
usersRouter.post('/verify-email', emailVerifyOTPValidator, wrapRequestHandler(verifyEmailController))

/**
 * @description Resend verify email
 * @path /users/resend-verify-email
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.post('/resend-verify-email', accessTokenValidator, wrapRequestHandler(resendVerifyEmailController))

/**
 * @description Forgot password
 * @path /users/forgot-password
 * @method POST
 * @body {
 *   email: string
 * }
 */
usersRouter.post('/forgot-password', forgotPasswordValidator, wrapRequestHandler(forgotPasswordController))

/**
 * @description Verify OTP for forgot password
 * @path /users/verify-forgot-password
 * @method POST
 * @body {
 *   email: string
 *   forgot_password_otp: string
 * }
 */
usersRouter.post(
  '/verify-forgot-password',
  verifyForgotPasswordOTPValidator,
  wrapRequestHandler(verifyForgotPasswordController)
)

/**
 * @description Reset password
 * @path /users/reset-password
 * @method POST
 * @body {
 *   email: string
 *   forgot_password_otp: string,
 *   password: string
 *   confirm_password: string
 * }
 */
usersRouter.post('/reset-password', resetPasswordValidator, wrapRequestHandler(resetPasswordController))

/**
 * @description Get my profile
 * @path /users/me
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.get('/me', accessTokenValidator, wrapRequestHandler(getMeController))

/**
 * @description Update my profile
 * @path /users/me
 * @method PATCH
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body: UserSchema
 */
usersRouter.patch(
  '/me',
  accessTokenValidator,
  // verifiedUserValidator,
  updateMeValidator,
  filterMiddleware<UpdateMeReqBody>([
    'name',
    'date_of_birth',
    'bio',
    'location',
    'website',
    'username',
    'avatar',
    'cover_photo',
    'twizz_circle'
  ]),
  wrapRequestHandler(updateMeController)
)

/**
 * @description Get followers list
 * @path /users/:user_id/followers
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.get('/:user_id/followers', accessTokenValidator,
  // verifiedUserValidator,
  wrapRequestHandler(getFollowersController))

/**
 * @description Get following list
 * @path /users/:user_id/following
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.get('/:user_id/following', accessTokenValidator,
  // verifiedUserValidator,
  wrapRequestHandler(getFollowingController))

/**
 * @description Get user profile by username
 * @path /users/:username
 * @method GET
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.get('/:username', accessTokenValidator,
  // verifiedUserValidator,
  wrapRequestHandler(getProfileController))

/**
 * @description Follow someone
 * @path /users/:username
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   followed_user_id: string
 * }
 */
usersRouter.post(
  '/follow',
  accessTokenValidator,
  // verifiedUserValidator,
  followValidator,
  wrapRequestHandler(followController)
)

/**
 * @description Unfollow someone
 * @path /users/follow/user_id
 * @method DELETE
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.delete(
  '/follow/:user_id',
  accessTokenValidator,
  // verifiedUserValidator,
  unfollowValidator,
  wrapRequestHandler(unfollowController)
)

/**
 * @description Change password
 * @path /users/change-password
 * @method PUT
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 * @body {
 *   old_password: string
 *   password: string
 *   confirm_password: string
 * }
 */
usersRouter.put(
  '/change-password',
  accessTokenValidator,
  // verifiedUserValidator,
  changePasswordValidator,
  wrapRequestHandler(changePasswordController)
)
export default usersRouter
