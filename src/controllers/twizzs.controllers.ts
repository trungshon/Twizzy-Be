import { Request, Response, NextFunction } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { TwizzReqBody } from '~/models/requests/Twizz.requests'
import twizzsService from '~/services/twizzs.services'
import { TWIZZ_MESSAGES } from '~/constants/messages'

export const createTwizzController = async (req: Request<ParamsDictionary, any, TwizzReqBody>, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const result = await twizzsService.createTwizz(user_id, req.body)
  return res.json({
    message: TWIZZ_MESSAGES.CREATE_TWIZZ_SUCCESSFULLY,
    result
  })
}
