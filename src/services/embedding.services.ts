import { pipeline, Pipeline } from '@xenova/transformers'
import { recoLog } from '~/utils/recommendationLogger'

class EmbeddingService {
  private extractor: any = null
  // Tên mô hình đa ngôn ngữ (hỗ trợ tiếng Việt) tốt nhất cho quy mô Mini
  private readonly MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

  /**
   * Khởi tạo mô hình AI (Lazy loading - chỉ nạp khi cần dùng)
   */
  private async getExtractor() {
    if (!this.extractor) {
      recoLog('Embedding', 'Đang nạp mô hình AI...', { model: this.MODEL_NAME })
      // Tạo pipeline để trích xuất đặc trưng (feature-extraction) từ văn bản
      this.extractor = await pipeline('feature-extraction', this.MODEL_NAME)
      recoLog('Embedding', 'Nạp mô hình thành công!')
    }
    return this.extractor
  }

  /**
   * Chuyển đổi văn bản thành Vector 384 chiều
   * @param text Nội dung cần chuyển đổi
   * @returns Mảng 384 số thực (Vector)
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim() === '') {
      // Trả về vector 0 nếu văn bản trống (để không làm lỗi DB)
      return new Array(384).fill(0)
    }

    try {
      const extractor = await this.getExtractor()
      
      // Thực hiện tính toán vector
      // pooling: 'mean' giúp gộp ý nghĩa của toàn bộ câu lại
      // normalize: true giúp vector có độ dài là 1, tối ưu cho tìm kiếm Cosine
      const output = await extractor(text, { 
        pooling: 'mean', 
        normalize: true 
      })

      // Chuyển kết quả từ Tensor sang mảng Javascript thông thường
      return Array.from(output.data) as number[]
    } catch (error) {
      recoLog('Embedding', 'Lỗi khi tạo embedding', { 
        text: text.slice(0, 50), 
        error: error instanceof Error ? error.message : String(error) 
      })
      // Fallback: trả về vector 0 nếu có lỗi để tránh crash hệ thống
      return new Array(384).fill(0)
    }
  }
}

const embeddingService = new EmbeddingService()
export default embeddingService
