import { Request, Response, NextFunction } from 'express'
import { TokenPayload } from '~/models/requests/User.requests'
import { ParamsDictionary } from 'express-serve-static-core'
import { Pagination, TweetQuery, TwizzParam, TwizzReqBody } from '~/models/requests/Twizz.requests'
import twizzsService from '~/services/twizzs.services'
import { TWIZZ_MESSAGES } from '~/constants/messages'
import { TwizzType } from '~/constants/enum'
import { HTTP_STATUS } from '~/constants/httpStatus'
import moderationService from '~/services/moderation.services'

export const createTwizzController = async (req: Request<ParamsDictionary, any, TwizzReqBody>, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload

  // ========== Kiểm duyệt nội dung trước khi đăng ==========
  // Chạy song song: kiểm duyệt văn bản (Gemini) + ảnh (Vision)
  const moderation = await moderationService.moderateContent({
    content: req.body.content,
    medias: req.body.medias
  })

  // Nếu vi phạm → log chi tiết + từ chối đăng bài
  if (!moderation.passed) {
    // Log chi tiết lên server terminal
    console.log('\n========== [Moderation] BÀI VIẾT BỊ TỪ CHỐI ==========')
    console.log(`[Moderation] User ID: ${user_id}`)
    console.log(`[Moderation] Nội dung: "${req.body.content?.substring(0, 100)}..."`)
    console.log(`[Moderation] Số media: ${req.body.medias?.length || 0}`)
    moderation.violations.forEach((v, i) => {
      console.log(`[Moderation] Vi phạm ${i + 1}: [${v.type}] ${v.reason}`)
    })
    console.log('=======================================================\n')

    // Ghép tất cả lý do vi phạm thành 1 chuỗi để hiện trên app
    const violationReasons = moderation.violations.map(v => v.reason).join('; ')

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      message: `Bài viết vi phạm tiêu chuẩn cộng đồng: ${violationReasons}`,
      violations: moderation.violations
    })
  }

  // Nội dung hợp lệ → tiến hành đăng bài
  const result = await twizzsService.createTwizz(user_id, req.body)
  return res.json({
    message: TWIZZ_MESSAGES.CREATE_TWIZZ_SUCCESSFULLY,
    result
  })
}

export const getTwizzController = async (req: Request, res: Response) => {
  const result = await twizzsService.increaseView(req.params.twizz_id, req.decoded_authorization?.user_id)
  const twizz = await twizzsService.getTwizz(req.params.twizz_id, req.decoded_authorization?.user_id)

  return res.json({
    message: TWIZZ_MESSAGES.GET_TWIZZ_SUCCESSFULLY,
    result: {
      ...twizz,
      user_views: result.user_views,
      guest_views: result.guest_views,
      updated_at: result.updated_at
    }
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

export const getUserTwizzsController = async (
  req: Request<{ user_id: string }, any, any, Pagination & { type?: string }>,
  res: Response
) => {
  const user_id = req.params.user_id
  const viewer_user_id = req.decoded_authorization?.user_id
  const limit = Number(req.query.limit)
  const page = Number(req.query.page)
  const type = req.query.type !== undefined ? (Number(req.query.type) as TwizzType) : undefined

  const result = await twizzsService.getUserTwizzs({
    user_id,
    viewer_user_id,
    type,
    limit,
    page
  })
  return res.json({
    message: TWIZZ_MESSAGES.GET_TWIZZ_SUCCESSFULLY,
    result: {
      twizzs: result.twizzs,
      limit,
      page,
      total_page: Math.ceil(result.total / limit)
    }
  })
}

export const deleteTwizzController = async (req: Request<TwizzParam>, res: Response) => {
  const { user_id } = req.decoded_authorization as TokenPayload
  await twizzsService.deleteTwizz(user_id, req.params.twizz_id)
  return res.json({
    message: TWIZZ_MESSAGES.DELETE_TWIZZ_SUCCESSFULLY
  })
}
