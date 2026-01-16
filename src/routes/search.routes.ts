import { Router } from 'express'
import { searchController } from '~/controllers/search.controllers'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/users.middlewares'
import { searchValidator } from '~/middlewares/search.middlewares'
import { paginationValidator } from '~/middlewares/twizzs.middlewares'

const searchRouter = Router()

/**
 * @description Search for users, twizzs, hashtags
 * @path /search
 * @method GET
 * @query {
 *   content: string (required)
 *   type?: 'users' | 'twizzs' (default: 'twizzs')
 *   field?: 'username' | 'name' (only for type='users')
 *   limit?: number (default: 10)
 *   page?: number (default: 1)
 *   media_type?: 'image' | 'video' (only for type='twizzs')
 *   people_follow?: '0' | '1' (only for type='twizzs')
 * }
 * @example
 * GET /search?content=john&type=users&field=username
 * GET /search?content=john&type=users&field=name
 * GET /search?content=hello&type=twizzs
 */
searchRouter.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  searchValidator,
  paginationValidator,
  searchController
)
export default searchRouter
