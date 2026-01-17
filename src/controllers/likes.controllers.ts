import { Request, Response } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { LIKE_MESSAGES } from '~/constants/messages'
import likesService from '~/services/likes.services'
import { Pagination } from '~/models/requests/Twizz.requests'

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

export const getUserLikedTwizzsController = async (
  req: Request<{ user_id: string }, any, any, Pagination>,
  res: Response
) => {
  const user_id = req.params.user_id
  const viewer_user_id = req.decoded_authorization?.user_id
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)

  const result = await likesService.getUserLikedTwizzs({
    user_id,
    viewer_user_id,
    limit,
    page
  })
  return res.json({
    message: LIKE_MESSAGES.LIKE_TWIZZ_SUCCESSFULLY,
    result: {
      twizzs: result.twizzs,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}
