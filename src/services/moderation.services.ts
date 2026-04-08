import vision from '@google-cloud/vision'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GoogleAIFileManager } from '@google/generative-ai/server'
import fs from 'fs'
import path from 'path'
import axios from 'axios'
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { Media } from '~/models/Other'
import { MediaType } from '~/constants/enum'

// ========== Kết quả kiểm duyệt ==========

// Kết quả vi phạm cho từng loại (text/image/video)
interface ModerationViolation {
  type: 'text' | 'image' | 'video' // Loại vi phạm
  reason: string // Lý do cụ thể (tiếng Việt)
}

// Kết quả kiểm duyệt tổng thể
interface ModerationResult {
  passed: boolean // true = nội dung hợp lệ, false = vi phạm
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
const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY as string)

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
      // Sử dụng model gemini-3.1-flash-lite-preview
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' })

      // Prompt yêu cầu Gemini phân tích nội dung
      // Trả về JSON chuẩn để dễ parse
      const prompt = `Bạn là một hệ thống kiểm duyệt nội dung mạng xã hội thông minh và thấu hiểu ngữ cảnh cho người dùng Việt Nam.
Hãy phân tích nội dung sau và đánh giá xem có thực sự vi phạm tiêu chuẩn cộng đồng không.

Nội dung cần kiểm tra:
"""
${content}
"""

Các tiêu chí vi phạm:
1. Ngôn từ thù ghét, phân biệt chủng tộc, giới tính, tôn giáo
2. Đe dọa, bạo lực, kích động bạo lực (thực sự)
3. Nội dung khiêu dâm, tình dục
4. Quấy rối, bắt nạt, xúc phạm cá nhân (có chủ đích tấn công ác ý)
5. Tự gây hại, khuyến khích tự tử
6. Thông tin sai lệch nghiêm trọng, lừa đảo

QUY TẮC QUAN TRỌNG VỀ NGỮ CẢNH (BẮT BUỘC TUÂN THỦ):
- Phải phân biệt được giữa LỜI CHỬI RỦA/TẤN CÔNG ÁC Ý thật sự với NHỮNG LỜI NÓI ĐÙA GIỠN, SLANG, TEENCODE thông thường của bạn bè.

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
      const cleanText = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()
      const analysis = JSON.parse(cleanText)

      // Nếu vi phạm → trả về thông tin vi phạm
      if (analysis.is_violation) {
        console.log(`[Moderation] Text bị từ chối: "${content.substring(0, 80)}..." → ${analysis.reason}`)
        return {
          passed: false,
          violations: [
            {
              type: 'text',
              reason: analysis.reason || 'Nội dung vi phạm tiêu chuẩn cộng đồng'
            }
          ]
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
      // BƯỚC 1: Chỉ gọi Vision API lấy SafeSearch Detection để tiết kiệm chi phí
      const [result] = await visionClient.annotateImage({
        image: { source: { imageUri: imageUrl } },
        features: [{ type: 'SAFE_SEARCH_DETECTION' }]
      })

      const safeSearch = result.safeSearchAnnotation
      console.log('[Moderation] Kết quả Vision API (SafeSearch):', JSON.stringify(safeSearch, null, 2))

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
      // BƯỚC 2: Nếu bị đánh dấu racy, LÚC NÀY MỚI GỌI API để quét nhãn (Label) nhằm đọc bối cảnh
      if (safeSearch.racy === 'VERY_LIKELY') {
        console.log('[Moderation] Ảnh bị đánh dấu RACY, tiến hành gọi thêm LABEL_DETECTION để xem xét bối cảnh...')

        const [labelResult] = await visionClient.annotateImage({
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'LABEL_DETECTION' }]
        })

        const labels = labelResult.labelAnnotations || []
        console.log('[Moderation] Kết quả Vision API (Labels - Fallback):', labels.map((l) => l.description).join(', '))

        // Các keyword hợp lệ biện minh cho ảnh khiêu gợi (Phải là MÔI TRƯỜNG/BỐI CẢNH như biển, bể bơi...)
        // NGHIÊM CẤM đưa các từ khóa quần áo (bikini, swimsuit, underwear, lingerie) vào đây
        // vì mặc bikini trong nhà vẫn là vi phạm ngữ cảnh.
        const allowedContextKeywords = [
          'beach',
          'pool',
          'swimming',
          'water',
          'sea',
          'ocean',
          'vacation',
          'coast',
          'sand',
          'resort',
          'outdoor'
        ]

        // Kiểm tra xem hình ảnh có chứa label nào trùng với keyword cho phép không
        const hasAllowedContext = labels.some((label) => {
          const desc = label.description?.toLowerCase() || ''
          return allowedContextKeywords.some((kw) => desc.includes(kw))
        })

        if (!hasAllowedContext) {
          violations.push({
            type: 'image',
            reason: 'Ảnh chứa nội dung khiêu gợi không phù hợp ngữ cảnh'
          })
        } else {
          console.log(
            `[Moderation] Bỏ qua lỗi RACY vì phát hiện ngữ cảnh hợp lệ (Biển/Hồ bơi/Đồ bơi) qua fallback label detection`
          )
        }
      }

      // Log kết quả
      const isRacyBlocked = violations.some((v) => v.reason.includes('khiêu gợi'))
      console.log(
        `[Moderation] Ảnh: adult=${safeSearch.adult}, violence=${safeSearch.violence}, racy=${safeSearch.racy} (Blocked: ${isRacyBlocked}) → ${violations.length === 0 ? 'Hợp lệ' : 'Vi phạm'}`
      )

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
  // TRÌNH PHỤ TRỢ - Tối ưu hóa Video Cloudinary
  // ====================================================
  // Nếu là URL Cloudinary, chèn các tham số nén để tải nhanh hơn và xử lý AI nhẹ hơn
  private _getOptimizedVideoUrl(videoUrl: string): string {
    if (videoUrl.includes('res.cloudinary.com') && videoUrl.includes('/video/upload/')) {
      // w_480: Rộng 480px, vc_h264: codec h264, br_500k: nén xuống 500kbps
      return videoUrl.replace('/video/upload/', '/video/upload/w_480,vc_h264,br_500k/')
    }
    return videoUrl
  }

  // ====================================================
  // KIỂM DUYỆT VIDEO - Sử dụng Gemini API
  // ====================================================
  async moderateVideo(videoUrl: string): Promise<ModerationResult> {
    const tempFilePath = path.join(__dirname, `temp_video_${Date.now()}.mp4`)
    let uploadedFile: any = null

    try {
      const optimizedUrl = this._getOptimizedVideoUrl(videoUrl)
      console.log(`[Moderation] Đang tải video về server tạm (đã tối ưu): ${optimizedUrl}`)

      // BƯỚC 1: Tải video về thư mục tạm
      const response = await axios({
        method: 'GET',
        url: optimizedUrl,
        responseType: 'stream'
      })

      const writer = fs.createWriteStream(tempFilePath)
      response.data.pipe(writer)

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => resolve())
        writer.on('error', (err) => reject(err))
      })

      console.log(`[Moderation] Upload video lên Gemini Files API...`)

      // BƯỚC 2: Upload lên Gemini Files API
      const uploadResult = await fileManager.uploadFile(tempFilePath, {
        mimeType: 'video/mp4'
      })
      uploadedFile = uploadResult.file // Lấy object file thật sự trả về từ upload

      let fileState = uploadedFile.state
      let fileUri = uploadedFile.uri
      const fileName = uploadedFile.name
      const fileMimeType = uploadedFile.mimeType

      // BƯỚC 3: Đợi trạng thái PROCESSING kết thúc
      while (fileState === 'PROCESSING') {
        console.log('[Moderation] Video đang được xử lý bởi Gemini (PROCESSING)...')
        await new Promise((resolve) => setTimeout(resolve, 2000))
        const getFileResult = await fileManager.getFile(fileName)
        fileState = getFileResult.state
        fileUri = getFileResult.uri
      }

      if (fileState === 'FAILED') {
        throw new Error('Gemini File processing failed')
      }

      console.log(`[Moderation] Video sẵn sàng. Bắt đầu phân tích bằng Gemini 3.1 Flash Lite...`)

      // BƯỚC 4: Phân tích bằng Gemini 3.1 Flash Lite
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' })

      const prompt = `Bạn là một hệ thống kiểm duyệt nội dung mạng xã hội cho đối tượng người Việt Nam.
Hãy phân tích video này có an toàn hay không.

Các tiêu chí vi phạm nghiêm cấm:
1. Nội dung bạo lực, máu me, kinh dị thực sự gây sợ hãi.
2. Nội dung người lớn, khiêu dâm, lỏa thể, quan hệ tình dục.
3. Kích động bạo động, lời nói thù ghét cực đoan.

Trả về CHỈ JSON theo định dạng sau (không markdown, không giải thích):
{
  "is_violation": true/false,
  "reason": "Tên tiêu chí vi phạm: \\"mô tả lỗi\\" (điền nếu vi phạm, trống nếu không)"
}`

      const result = await model.generateContent([
        {
          fileData: {
            fileUri: fileUri,
            mimeType: fileMimeType
          }
        },
        prompt
      ])

      const text = result.response.text()
      const cleanText = text
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim()

      const analysis = JSON.parse(cleanText)

      // Xóa file trên Gemini để tránh rác bộ nhớ
      await fileManager.deleteFile(fileName)
      uploadedFile = null

      if (analysis.is_violation) {
        console.log(`[Moderation] Video bị từ chối 🔥 → ${analysis.reason}`)
        return {
          passed: false,
          violations: [
            {
              type: 'video',
              reason: analysis.reason || 'Video chứa nội dung vi phạm tiêu chuẩn cộng đồng'
            }
          ]
        }
      }

      console.log('[Moderation] Video hợp lệ ✅')
      return { passed: true, violations: [] }
    } catch (error: any) {
      console.error('[Moderation] Lỗi kiểm duyệt video bằng Gemini:', error)

      // Dọn dẹp file trên Gemini nếu bị kẹt lỗi
      if (uploadedFile && uploadedFile.name) {
        try {
          await fileManager.deleteFile(uploadedFile.name)
        } catch (e) {
          // ignore error during cleanup
        }
      }

      return { passed: true, violations: [] }
    } finally {
      // Dọn dẹp file tạm trên server local
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    }
  }

  // ====================================================
  // KIỂM DUYỆT TỔNG THỂ - Kết hợp text + image + video
  // ====================================================
  // Chạy song song tất cả kiểm duyệt bằng Promise.all
  // Nếu BẤT KỲ phần nào vi phạm → reject toàn bộ bài viết
  async moderateContent({ content, medias }: { content: string; medias: Media[] }): Promise<ModerationResult> {
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
      const imageMedias = medias.filter((m) => m.type === MediaType.Image)
      for (const media of imageMedias) {
        moderationTasks.push(this.moderateImage(media.url))
      }
    } else {
      console.log('[Moderation] ⏩ Bỏ qua kiểm duyệt IMAGE (bị tắt trong .env)')
    }

    // 3. Kiểm duyệt từng video (nếu được bật)
    const isVideoModerationEnabled = process.env.MODERATE_VIDEO !== 'false'
    if (isVideoModerationEnabled) {
      const videoMedias = medias.filter((m) => m.type === MediaType.Video)
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
    const allViolations = results.flatMap((r) => r.violations)

    // Lọc bỏ các vi phạm trùng lặp lý do (khi đăng nhiều ảnh cùng vi phạm 1 lỗi)
    const uniqueViolations = allViolations.filter(
      (v, index, self) => index === self.findIndex((t) => t.reason === v.reason)
    )

    return {
      passed: uniqueViolations.length === 0, // Hợp lệ nếu không có vi phạm nào
      violations: uniqueViolations // Danh sách các vi phạm (không trùng lặp)
    }
  }
}

// Export singleton instance
const moderationService = new ModerationService()
export default moderationService
