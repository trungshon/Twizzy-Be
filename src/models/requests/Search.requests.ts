import { Query } from 'express-serve-static-core'
import { Pagination } from './Twizz.requests'
import { MediaTypeQuery, PeopleFollow } from '~/constants/enum'

export interface SearchQuery extends Pagination, Query {
  content: string
  media_type?: MediaTypeQuery
  people_follow?: PeopleFollow
  type?: 'users' | 'twizzs'
  field?: 'username' | 'name'
}
