import { Router } from 'express'
import {
  accessTokenValidator,
  loginValidator,
  registerValidator,
  refreshTokenValidator,
  emailVerifyTokenValidator
} from '../middlewares/users.middlewares'
import {
  loginController,
  registerController,
  logoutController,
  refreshTokenController,
  verifyEmailController,
  resendVerifyEmailController
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
 *   email_verify_token: string
 * }
 * @response {

 * }
 */
usersRouter.post('/verify-email', emailVerifyTokenValidator, wrapRequestHandler(verifyEmailController))

/**
 * @description Resend verify email
 * @path /users/resend-verify-email
 * @method POST
 * @header {
 *   Authorization: Bearer <access_token>
 * }
 */
usersRouter.post('/resend-verify-email', accessTokenValidator, wrapRequestHandler(resendVerifyEmailController))

export default usersRouter
