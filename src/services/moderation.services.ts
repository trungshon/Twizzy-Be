import vision from '@google-cloud/vision'
import { GoogleGenerativeAI } from '@google/generative-ai'
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { Media } from '~/models/Other'
import { MediaType } from '~/constants/enum'

// ========== Kết quả kiểm duyệt ==========

// Kết quả vi phạm cho từng loại (text/image/video)
interface ModerationViolation {
    type: 'text' | 'image' | 'video' // Loại vi phạm
    reason: string                    // Lý do cụ thể (tiếng Việt)
}

// Kết quả kiểm duyệt tổng thể
interface ModerationResult {
    passed: boolean                   // true = nội dung hợp lệ, false = vi phạm
    violations: ModerationViolation[] // Danh sách vi phạm (nếu có)
}

// ========== Khởi tạo Google Vision Client ==========
// Sử dụng Service Account key để xác thực
const visionClient = new vision.ImageAnnotatorClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
})

// ========== Khởi tạo Gemini Client ==========
// Sử dụng API key để gọi Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string)

class ModerationService {

    // ====================================================
    // KIỂM DUYỆT VĂN BẢN - Sử dụng Gemini API
    // ====================================================
    // Gửi nội dung cho Gemini phân tích và trả về kết quả
    // Gemini sẽ đánh giá: thù ghét, bạo lực, tình dục, quấy rối, tự gây hại
    async moderateText(content: string): Promise<ModerationResult> {
        // Bỏ qua nếu nội dung trống
        if (!content || content.trim() === '') {
            return { passed: true, violations: [] }
        }

        try {
            // Sử dụng model gemini-2.0-flash (nhanh, miễn phí)
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

            // Prompt yêu cầu Gemini phân tích nội dung
            // Trả về JSON chuẩn để dễ parse
            const prompt = `Bạn là hệ thống kiểm duyệt nội dung mạng xã hội.
Hãy phân tích nội dung sau và đánh giá xem có vi phạm tiêu chuẩn cộng đồng không.

Nội dung cần kiểm tra:
"""
${content}
"""

Các tiêu chí vi phạm:
1. Ngôn từ thù ghét, phân biệt chủng tộc, giới tính, tôn giáo
2. Đe dọa, bạo lực, kích động bạo lực
3. Nội dung khiêu dâm, tình dục
4. Quấy rối, bắt nạt, xúc phạm cá nhân
5. Tự gây hại, khuyến khích tự tử
6. Thông tin sai lệch nghiêm trọng, lừa đảo

Quy tắc trả kết quả:
- Nếu vi phạm: trả về tên tiêu chí vi phạm + trích dẫn CHÍNH XÁC từ/cụm từ vi phạm trong nội dung
- Nếu cùng 1 tiêu chí có nhiều từ vi phạm: GỘP các từ lại, phân cách bằng dấu phẩy
- Nếu vi phạm nhiều tiêu chí khác nhau: phân cách bằng dấu "; "
- Ví dụ reason: "Quấy rối, xúc phạm cá nhân: \\"đồ ngu\\", \\"đồ ăn hại\\"; Đe dọa, bạo lực: \\"tao giết mày\\""

Trả về CHỈ JSON (không markdown, không giải thích thêm):
{
  "is_violation": true/false,
  "reason": "Tên tiêu chí: \\"từ vi phạm\\" (nếu vi phạm, để trống nếu không)"
}`

            // Gọi Gemini API
            const result = await model.generateContent(prompt)
            const response = result.response
            const text = response.text()

            // Parse JSON kết quả từ Gemini
            // Loại bỏ markdown code block nếu có (```json ... ```)
            const cleanText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
            const analysis = JSON.parse(cleanText)

            // Nếu vi phạm → trả về thông tin vi phạm
            if (analysis.is_violation) {
                console.log(`[Moderation] Text bị từ chối: "${content.substring(0, 80)}..." → ${analysis.reason}`)
                return {
                    passed: false,
                    violations: [{
                        type: 'text',
                        reason: analysis.reason || 'Nội dung vi phạm tiêu chuẩn cộng đồng'
                    }]
                }
            }

            // Không vi phạm
            console.log(`[Moderation] Text hợp lệ: "${content.substring(0, 80)}..."`)
            return { passed: true, violations: [] }

        } catch (error) {
            // Nếu Gemini API lỗi → cho qua (không block user)
            // Log lỗi để debug nhưng không reject bài viết
            console.error('[Moderation] Lỗi kiểm duyệt văn bản:', error)
            return { passed: true, violations: [] }
        }
    }

    // ====================================================
    // KIỂM DUYỆT ẢNH - Sử dụng Google Cloud Vision API
    // ====================================================
    // Gửi URL ảnh cho Vision API → nhận kết quả SafeSearch
    // SafeSearch phát hiện: adult, violence, racy, spoof, medical
    async moderateImage(imageUrl: string): Promise<ModerationResult> {
        try {
            // Gọi Vision API SafeSearch Detection
            // Truyền URL ảnh (Cloudinary URL) trực tiếp
            const [result] = await visionClient.safeSearchDetection(imageUrl)
            const safeSearch = result.safeSearchAnnotation

            // Nếu không có kết quả → cho qua
            if (!safeSearch) {
                return { passed: true, violations: [] }
            }

            const violations: ModerationViolation[] = []

            // Các mức độ: UNKNOWN, VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY, VERY_LIKELY
            // Chỉ reject khi mức độ LIKELY hoặc VERY_LIKELY
            const dangerousLevels = ['LIKELY', 'VERY_LIKELY']

            // Kiểm tra nội dung người lớn (khiêu dâm)
            if (dangerousLevels.includes(safeSearch.adult as string)) {
                violations.push({
                    type: 'image',
                    reason: 'Ảnh chứa nội dung người lớn/khiêu dâm'
                })
            }

            // Kiểm tra nội dung bạo lực
            if (dangerousLevels.includes(safeSearch.violence as string)) {
                violations.push({
                    type: 'image',
                    reason: 'Ảnh chứa nội dung bạo lực'
                })
            }

            // Kiểm tra nội dung khiêu gợi (racy)
            // Chỉ block khi VERY_LIKELY (racy có thể là ảnh bikini, bãi biển...)
            if (safeSearch.racy === 'VERY_LIKELY') {
                violations.push({
                    type: 'image',
                    reason: 'Ảnh chứa nội dung khiêu gợi'
                })
            }

            // Log kết quả
            console.log(`[Moderation] Ảnh: adult=${safeSearch.adult}, violence=${safeSearch.violence}, racy=${safeSearch.racy} → ${violations.length === 0 ? 'Hợp lệ' : 'Vi phạm'}`)

            return {
                passed: violations.length === 0,
                violations
            }

        } catch (error) {
            // Nếu Vision API lỗi → cho qua
            console.error('[Moderation] Lỗi kiểm duyệt ảnh:', error)
            return { passed: true, violations: [] }
        }
    }

    // ====================================================
    // KIỂM DUYỆT VIDEO - Sử dụng Sightengine API
    // ====================================================
    // Gửi URL video cho Sightengine → nhận kết quả kiểm duyệt
    // Kiểm tra: nudity, violence, offensive, drugs, weapons, gore
    async moderateVideo(videoUrl: string): Promise<ModerationResult> {
        try {
            console.log(`[Moderation] Đang kiểm duyệt video: ${videoUrl}`)

            // Gọi Sightengine API kiểm duyệt video qua URL (theo docs chính thức)
            // Dùng axios + FormData để POST lên endpoint check-sync.json
            const FormData = require('form-data')
            const axios = require('axios')

            const data = new FormData()
            data.append('stream_url', videoUrl)
            data.append('models', 'nudity-2.1,violence,gore')
            data.append('api_user', process.env.SIGHTENGINE_USER as string)
            data.append('api_secret', process.env.SIGHTENGINE_SECRET as string)

            const response = await axios({
                method: 'post',
                url: 'https://api.sightengine.com/1.0/video/check-sync.json',
                data,
                headers: data.getHeaders(),
                timeout: 90000   // Timeout 90s vì video cần thời gian xử lý
            })
            const result = response.data
            console.log('[Moderation] Kết quả Sightengine:', JSON.stringify(result, null, 2))

            const violations: ModerationViolation[] = []

            // result.data.frames là mảng các frame snapshot của video
            const frames: any[] = result?.data?.frames ?? []

            for (const frame of frames) {
                // ---- Nudity 2.1: sexual_activity, sexual_display, erotica + very_suggestive ----
                if (frame.nudity) {
                    const { sexual_activity = 0, sexual_display = 0, erotica = 0, very_suggestive = 0 } = frame.nudity
                    const contextPool = frame.nudity.context?.sea_lake_pool ?? 0

                    const isExplicit = sexual_activity > 0.7 || sexual_display > 0.7 || erotica > 0.75

                    // 2. Suggestive content (gợi cảm mạnh) NHƯNG không phải ở biển/hồ bơi
                    const isInappropriateSuggestive = very_suggestive > 0.8 && contextPool < 0.5

                    if (isExplicit || isInappropriateSuggestive) {
                        if (!violations.some(v => v.reason.includes('khiêu dâm'))) {
                            violations.push({ type: 'video', reason: 'Video chứa nội dung khiêu dâm hoặc khêu gợi quá mức' })
                        }
                    }
                }

                // ---- Violence ----
                if ((frame.violence?.prob ?? 0) > 0.75) {
                    if (!violations.some(v => v.reason.includes('bạo lực'))) {
                        violations.push({ type: 'video', reason: 'Video chứa nội dung bạo lực' })
                    }
                }

                // ---- Gore (máu me, kinh dị) ----
                if ((frame.gore?.prob ?? 0) > 0.75) {
                    if (!violations.some(v => v.reason.includes('kinh dị'))) {
                        violations.push({ type: 'video', reason: 'Video chứa nội dung máu me, kinh dị' })
                    }
                }
            }

            console.log(`[Moderation] Video → ${violations.length === 0 ? 'Hợp lệ' : `Vi phạm: ${violations.map(v => v.reason).join(', ')}`}`)

            return {
                passed: violations.length === 0,
                violations
            }

        } catch (error) {
            // Nếu Sightengine API lỗi → cho qua (không block user)
            console.error('[Moderation] Lỗi kiểm duyệt video:', error)
            return { passed: true, violations: [] }
        }
    }

    // ====================================================
    // KIỂM DUYỆT TỔNG THỂ - Kết hợp text + image + video
    // ====================================================
    // Chạy song song tất cả kiểm duyệt bằng Promise.all
    // Nếu BẤT KỲ phần nào vi phạm → reject toàn bộ bài viết
    async moderateContent({ content, medias }: { content: string, medias: Media[] }): Promise<ModerationResult> {
        // Tạo danh sách các promise kiểm duyệt
        const moderationTasks: Promise<ModerationResult>[] = []

        // 1. Kiểm duyệt văn bản (nếu có nội dung và được bật)
        const isTextModerationEnabled = process.env.MODERATE_TEXT !== 'false'
        if (isTextModerationEnabled && content && content.trim() !== '') {
            moderationTasks.push(this.moderateText(content))
        } else if (!isTextModerationEnabled) {
            console.log('[Moderation] ⏩ Bỏ qua kiểm duyệt TEXT (bị tắt trong .env)')
        }

        // 2. Kiểm duyệt từng ảnh (nếu được bật)
        const isImageModerationEnabled = process.env.MODERATE_IMAGE !== 'false'
        if (isImageModerationEnabled) {
            const imageMedias = medias.filter(m => m.type === MediaType.Image)
            for (const media of imageMedias) {
                moderationTasks.push(this.moderateImage(media.url))
            }
        } else {
            console.log('[Moderation] ⏩ Bỏ qua kiểm duyệt IMAGE (bị tắt trong .env)')
        }

        // 3. Kiểm duyệt từng video bằng Sightengine (nếu được bật)
        const isVideoModerationEnabled = process.env.MODERATE_VIDEO !== 'false'
        if (isVideoModerationEnabled) {
            const videoMedias = medias.filter(m => m.type === MediaType.Video)
            for (const media of videoMedias) {
                moderationTasks.push(this.moderateVideo(media.url))
            }
        } else {
            console.log('[Moderation] ⏩ Bỏ qua kiểm duyệt VIDEO (bị tắt trong .env)')
        }

        // Nếu không có gì cần kiểm duyệt → cho qua
        if (moderationTasks.length === 0) {
            return { passed: true, violations: [] }
        }

        // Chạy tất cả kiểm duyệt song song → nhanh hơn chạy tuần tự
        const results = await Promise.all(moderationTasks)

        // Gom tất cả vi phạm từ các kết quả
        const allViolations = results.flatMap(r => r.violations)

        return {
            passed: allViolations.length === 0,   // Hợp lệ nếu không có vi phạm nào
            violations: allViolations              // Danh sách tất cả vi phạm
        }
    }
}

// Export singleton instance
const moderationService = new ModerationService()
export default moderationService
