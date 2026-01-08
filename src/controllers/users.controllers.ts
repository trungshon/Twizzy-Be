import { Request, Response } from 'express'
import usersService from '~/services/users.services'
import { ParamsDictionary } from 'express-serve-static-core'
import { RegisterReqBody } from '~/models/requests/User.requests'
import { NextFunction } from 'express-serve-static-core'

export const loginController = (req: Request, res: Response) => {
  const { email, password } = req.body
  if (email === 'test@test.com' && password === '123456') {
    return res.json({
      message: 'Login successful'
    })
  }
  return res.status(400).json({
    message: 'Login failed'
  })
}

export const registerController = async (
  req: Request<ParamsDictionary, any, RegisterReqBody>,
  res: Response,
  next: NextFunction
) => {
  const result = await usersService.register(req.body)
  return res.json({
    message: 'Register successful',
    result
  })
}
