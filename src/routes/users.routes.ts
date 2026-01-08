import { Router } from 'express'
import { loginValidator, registerValidator } from '../middlewares/users.middlewares'
import { loginController, registerController } from '../controllers/users.controllers'
import wrapRequestHandler from '~/utils/handlers'
const usersRouter = Router()

usersRouter.post('/login', loginValidator, loginController)
usersRouter.post('/register', registerValidator, wrapRequestHandler(registerController))

export default usersRouter
