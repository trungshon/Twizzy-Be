import { Router } from 'express'
import {
  accessTokenValidator,
  loginValidator,
  registerValidator,
  refreshTokenValidator
} from '../middlewares/users.middlewares'
import {
  loginController,
  registerController,
  logoutController,
  refreshTokenController
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

export default usersRouter
