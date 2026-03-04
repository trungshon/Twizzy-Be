import vision from '@google-cloud/vision'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Media } from '~/models/Other'
import { MediaType } from '~/constants/enum'

// ========== Kết quả kiểm duyệt ==========

// Kết quả vi phạm cho từng loại (text/image)
interface ModerationViolation {
    type: 'text' | 'image'           // Loại vi phạm
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
    // KIỂM DUYỆT TỔNG THỂ - Kết hợp text + image
    // ====================================================
    // Chạy song song tất cả kiểm duyệt bằng Promise.all
    // Nếu BẤT KỲ phần nào vi phạm → reject toàn bộ bài viết
    async moderateContent({ content, medias }: { content: string, medias: Media[] }): Promise<ModerationResult> {
        // Tạo danh sách các promise kiểm duyệt
        const moderationTasks: Promise<ModerationResult>[] = []

        // 1. Kiểm duyệt văn bản (nếu có nội dung)
        if (content && content.trim() !== '') {
            moderationTasks.push(this.moderateText(content))
        }

        // 2. Kiểm duyệt từng ảnh (chỉ ảnh, không check video ở đây)
        const imageMedias = medias.filter(m => m.type === MediaType.Image)
        for (const media of imageMedias) {
            moderationTasks.push(this.moderateImage(media.url))
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
