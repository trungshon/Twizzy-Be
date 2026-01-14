import { Request, Response } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { LIKE_MESSAGES } from '~/constants/messages'
import likesService from '~/services/likes.services'

import { LikeTwizzReqBody } from '~/models/requests/Like.requests'

export const likeTwizzController = async (req: Request<ParamsDictionary, any, LikeTwizzReqBody>, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const result = await likesService.likeTwizz(user_id, req.body.twizz_id)
  return res.json({
    message: LIKE_MESSAGES.LIKE_TWIZZ_SUCCESSFULLY,
    result
  })
}

export const unlikeTwizzController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  await likesService.unlikeTwizz(user_id, req.params.twizz_id)
  return res.json({
    message: LIKE_MESSAGES.UNLIKE_TWIZZ_SUCCESSFULLY
  })
}
