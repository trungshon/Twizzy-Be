import { Request, Response } from 'express'
import moderationService from '~/services/moderation.services'

export const moderateTextController = async (req: Request, res: Response) => {
    const { content } = req.body

    // Tối ưu: Kiểm tra biến môi trường để bật/tắt duyệt text
    const isTextModerationEnabled = process.env.MODERATE_TEXT !== 'false'
    if (!isTextModerationEnabled) {
        return res.json({
            message: 'Bỏ qua kiểm duyệt văn bản (bị tắt)',
            result: {
                passed: true,
                violations: [],
                is_violation: false,
                signature: moderationService.generateTextSignature(content)
            }
        })
    }

    const result = await moderationService.moderateText(content)

    // Nếu hợp lệ → tạo chữ ký để App gửi kèm lúc đăng bài (giúp skip duyệt lần 2)
    let signature = ''
    if (result.passed) {
        signature = moderationService.generateTextSignature(content)
    }

    return res.json({
        message: 'Kiểm duyệt văn bản thành công',
        result: {
            ...result,
            signature
        }
    })
}
