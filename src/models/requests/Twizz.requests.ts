import { TwizzAudience, TwizzType } from '~/constants/enum'
import { Media } from '~/models/Other'

export interface TwizzReqBody {
  type: TwizzType
  audience: TwizzAudience
  content: string
  parent_id: null | string
  hashtags: string[]
  mentions: string[]
  medias: Media[]
}
