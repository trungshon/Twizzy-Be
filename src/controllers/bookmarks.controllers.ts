import { Request, Response, NextFunction } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { BOOKMARK_MESSAGES } from '~/constants/messages'
import { BookmarkTwizzReqBody } from '~/models/requests/Bookmark.requests'
import bookmarksService from '~/services/bookmarks.services'
import { Pagination } from '~/models/requests/Twizz.requests'

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

export const getUserBookmarkedTwizzsController = async (
  req: Request<{ user_id: string }, any, any, Pagination>,
  res: Response
) => {
  const user_id = req.params.user_id
  const viewer_user_id = req.decoded_authorization?.user_id
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)

  const result = await bookmarksService.getUserBookmarkedTwizzs({
    user_id,
    viewer_user_id,
    limit,
    page
  })
  return res.json({
    message: BOOKMARK_MESSAGES.BOOKMARK_TWIZZ_SUCCESSFULLY,
    result: {
      twizzs: result.twizzs,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}

export const getUsersWhoBookmarkedTwizzController = async (
  req: Request<{ twizz_id: string }, any, any, Pagination>,
  res: Response
) => {
  const twizz_id = req.params.twizz_id
  const viewer_user_id = req.decoded_authorization?.user_id
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)

  const result = await bookmarksService.getUsersWhoBookmarkedTwizz({
    twizz_id,
    viewer_user_id,
    limit,
    page
  })
  return res.json({
    message: BOOKMARK_MESSAGES.BOOKMARK_TWIZZ_SUCCESSFULLY,
    result: {
      users: result.users,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}
