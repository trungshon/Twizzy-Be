import { Request, Response, NextFunction } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { BOOKMARK_MESSAGES } from '~/constants/messages'
import { BookmarkTwizzReqBody } from '~/models/requests/Bookmark.requests'
import bookmarksService from '~/services/bookmarks.services'

export const bookmarkTwizzController = async (
  req: Request<ParamsDictionary, any, BookmarkTwizzReqBody>,
  res: Response
) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  const result = await bookmarksService.bookmarkTwizz(user_id, req.body.twizz_id)
  return res.json({
    message: BOOKMARK_MESSAGES.BOOKMARK_TWIZZ_SUCCESSFULLY,
    result
  })
}

export const unbookmarkTwizzController = async (req: Request, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  await bookmarksService.unbookmarkTwizz(user_id, req.params.twizz_id)
  return res.json({
    message: BOOKMARK_MESSAGES.UNBOOKMARK_TWIZZ_SUCCESSFULLY
  })
}
