import { Request, Response } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import { SearchQuery } from '~/models/requests/Search.requests'
import searchService from '~/services/search.services'
import { SEARCH_MESSAGES } from '~/constants/messages'
import { MediaTypeQuery } from '~/constants/enum'

export const searchController = async (req: Request<ParamsDictionary, any, any, SearchQuery>, res: Response) => {
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)
  const searchType = req.query.type || 'twizzs'

  if (searchType === 'users') {
    const result = await searchService.searchUsers({
      content: req.query.content as string,
      limit,
      page,
      field: req.query.field
    })
    return res.json({
      message: SEARCH_MESSAGES.SEARCH_SUCCESSFULLY,
      result: {
        users: result.users,
        limit,
        page,
        total_page: Math.ceil(result.total / limit)
      }
    })
  }

  // Default: search twizzs
  const result = await searchService.search({
    content: req.query.content as string,
    limit,
    page,
    user_id: req.decoded_authorization?.user_id as string,
    media_type: req.query.media_type,
    people_follow: req.query.people_follow
  })
  return res.json({
    message: SEARCH_MESSAGES.SEARCH_SUCCESSFULLY,
    result: {
      twizzs: result.twizzs,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}
