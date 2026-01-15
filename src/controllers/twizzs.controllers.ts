import { Request, Response, NextFunction } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { Pagination, TweetQuery, TwizzParam, TwizzReqBody } from '~/models/requests/Twizz.requests'
import twizzsService from '~/services/twizzs.services'
import { TWIZZ_MESSAGES } from '~/constants/messages'
import { TwizzType } from '~/constants/enum'

export const createTwizzController = async (req: Request<ParamsDictionary, any, TwizzReqBody>, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const result = await twizzsService.createTwizz(user_id, req.body)
  return res.json({
    message: TWIZZ_MESSAGES.CREATE_TWIZZ_SUCCESSFULLY,
    result
  })
}

export const getTwizzController = async (req: Request, res: Response) => {
  const result = await twizzsService.increaseView(req.params.twizz_id, req.decoded_authorization?.user_id)
  const twizz = {
    ...req.twizz,
    user_views: result.user_views,
    guest_views: result.guest_views,
    updated_at: result.updated_at
  }
  return res.json({
    message: TWIZZ_MESSAGES.GET_TWIZZ_SUCCESSFULLY,
    result: twizz
  })
}

export const getTwizzChildrenController = async (req: Request<TwizzParam, any, any, TweetQuery>, res: Response) => {
  const twizz_type = Number(req.query.twizz_type) as TwizzType
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)
  const user_id = req.decoded_authorization?.user_id

  const { twizzs, total } = await twizzsService.getTwizzChildren({
    twizz_id: req.params.twizz_id,
    twizz_type,
    limit,
    page,
    user_id
  })
  return res.json({
    message: TWIZZ_MESSAGES.GET_TWIZZ_CHILDREN_SUCCESSFULLY,
    result: {
      twizzs,
      twizz_type,
      limit,
      page,
      total_page: Math.ceil(total / limit)
    }
  })
}

export const getNewFeedsController = async (req: Request<ParamsDictionary, any, any, Pagination>, res: Response) => {
  const user_id = req.decoded_authorization?.user_id as string
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)
  const result = await twizzsService.getNewFeeds({
    user_id,
    limit,
    page
  })
  return res.json({
    message: TWIZZ_MESSAGES.GET_NEW_FEEDS_SUCCESSFULLY,
    result: { 
      twizzs: result.twizzs,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}
