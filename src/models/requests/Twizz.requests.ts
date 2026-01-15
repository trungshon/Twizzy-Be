import { TwizzAudience, TwizzType } from '~/constants/enum'
import { Media } from '~/models/Other'
import { ParamsDictionary, Query } from 'express-serve-static-core'

export interface TwizzReqBody {
  type: TwizzType
  audience: TwizzAudience
  content: string
  parent_id: null | string
  hashtags: string[]
  mentions: string[]
  medias: Media[]
}

export interface TweetQuery extends Pagination, Query {
  twizz_type: string
}

export interface TwizzParam extends ParamsDictionary {
  twizz_id: string
}

export interface Pagination {
  limit: string
  page: string
}
