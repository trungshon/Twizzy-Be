import { Router } from 'express'
import {
  accessTokenValidator,
  loginValidator,
  registerValidator,
  refreshTokenValidator,
  emailVerifyOTPValidator,
  forgotPasswordValidator,
  verifyForgotPasswordOTPValidator,
  resetPasswordValidator
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
  getMeController
} from '../controllers/users.controllers'
import wrapRequestHandler from '~/utils/handlers'
import { USER_MESSAGES } from '~/constants/messages'
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

export default usersRouter
