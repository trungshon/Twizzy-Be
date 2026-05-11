import { spawn } from 'child_process'
import path from 'path'
import { recoLog } from '~/utils/recommendationLogger'

// Kết quả trả về từ Python script
interface NLPResult {
  tokens: string[]
  hashtag_tokens: string[]
  mentions: string[]
  error?: string
}

interface NLPBatchResult {
  batch_results: NLPResult[]
  error?: string
}

// Cache in-memory để tránh gọi Python script lại cho cùng một văn bản
interface CacheEntry {
  result: NLPResult
  expiredAt: number
}

class NLPService {
  private pythonScriptPath: string
  // Cache tokens đã xử lý (TTL: 24 giờ)
  private tokenCache: Map<string, CacheEntry>
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000

  constructor() {
    this.pythonScriptPath = path.join(__dirname, '../scripts/process_vietnamese.py')
    this.tokenCache = new Map()
  }

  /**
   * Gọi Python script để xử lý một văn bản tiếng Việt.
   * Sử dụng cache để tránh gọi lại cho cùng một văn bản.
   */
  async processText(text: string): Promise<NLPResult> {
    if (!text || !text.trim()) {
      return { tokens: [], hashtag_tokens: [], mentions: [] }
    }

    // Kiểm tra cache
    const cacheKey = text.trim()
    const cached = this.tokenCache.get(cacheKey)
    if (cached && cached.expiredAt > Date.now()) {
      return cached.result
    }

    try {
      const result = await this.callPythonScript(JSON.stringify({ text }))
      const nlpResult = result as NLPResult

      // Lưu vào cache
      this.tokenCache.set(cacheKey, {
        result: nlpResult,
        expiredAt: Date.now() + this.CACHE_TTL_MS
      })

      return nlpResult
    } catch (err) {
      // Fallback: tách từ đơn giản nếu Python không khả dụng
      recoLog('NLP', 'processText: lỗi Python → fallback đơn giản', {
        lỗi: err instanceof Error ? err.message : String(err)
      })
      return this.fallbackProcess(text)
    }
  }

  /**
   * Xử lý nhiều văn bản cùng lúc (batch processing).
   * Tách thành: dùng cache cho những text đã có, gọi Python cho những text chưa có.
   */
  async processBatch(texts: string[]): Promise<NLPResult[]> {
    if (!texts.length) return []

    recoLog('NLP', 'processBatch: bắt đầu', { tổngText: texts.length })

    const results: NLPResult[] = new Array(texts.length)
    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    // Phân loại: đã cache và chưa cache
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]
      if (!text || !text.trim()) {
        results[i] = { tokens: [], hashtag_tokens: [], mentions: [] }
        continue
      }
      const cached = this.tokenCache.get(text.trim())
      if (cached && cached.expiredAt > Date.now()) {
        results[i] = cached.result
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(text)
      }
    }

    // Gọi Python batch cho những text chưa cache
    if (uncachedTexts.length > 0) {
      recoLog('NLP', 'processBatch: gọi Python cho phần chưa cache', {
        đãCache: texts.length - uncachedTexts.length,
        chưaCache: uncachedTexts.length
      })
      try {
        const batchResult = await this.callPythonScript(JSON.stringify(uncachedTexts))
        const { batch_results } = batchResult as NLPBatchResult

        batch_results.forEach((result, idx) => {
          const originalIdx = uncachedIndices[idx]
          results[originalIdx] = result
          // Lưu cache cho từng kết quả
          const text = uncachedTexts[idx]
          this.tokenCache.set(text.trim(), {
            result,
            expiredAt: Date.now() + this.CACHE_TTL_MS
          })
        })
      } catch (err) {
        // Fallback cho tất cả text chưa cache
        recoLog('NLP', 'processBatch: lỗi Python → fallback toàn bộ batch chưa cache', {
          sốText: uncachedTexts.length,
          lỗi: err instanceof Error ? err.message : String(err)
        })
        uncachedIndices.forEach((originalIdx, idx) => {
          results[originalIdx] = this.fallbackProcess(uncachedTexts[idx])
        })
      }
    } else {
      recoLog('NLP', 'processBatch: toàn bộ text đã có trong cache', { tổngText: texts.length })
    }

    recoLog('NLP', 'processBatch: hoàn tất', { tổngText: texts.length })

    return results
  }

  /**
   * Gọi Python script, truyền input qua stdin và nhận output từ stdout.
   */
  private callPythonScript(jsonInput: string): Promise<object> {
    return new Promise((resolve, reject) => {
      // Ưu tiên python3 trên mọi nền tảng
      // Trên Windows: đặt biến môi trường PYTHON_PATH để ghi đè nếu cần
      const pythonCmd = process.env.PYTHON_PATH ?? (process.platform === 'win32' ? 'python3' : 'python3')
      const child = spawn(pythonCmd, [this.pythonScriptPath])

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`Python script thoát với mã lỗi ${code}: ${stderr}`))
          return
        }
        try {
          const result = JSON.parse(stdout.trim())
          if (result.error) {
            reject(new Error(result.error))
          } else {
            resolve(result)
          }
        } catch {
          reject(new Error(`Không thể parse JSON từ Python script: ${stdout}`))
        }
      })

      child.on('error', (err: Error) => {
        reject(new Error(`Không thể khởi chạy Python script: ${err.message}`))
      })

      // Gửi input vào stdin
      child.stdin.write(jsonInput)
      child.stdin.end()
    })
  }

  /**
   * Fallback khi Python/underthesea không khả dụng:
   * Tách từ đơn giản theo khoảng trắng.
   */
  private fallbackProcess(text: string): NLPResult {
    const normalized = text.toLowerCase().replace(/[^\w\s#@]/gu, ' ')
    const tokens = normalized
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .slice(0, 200) // Giới hạn số lượng token

    const hashtag_tokens = tokens.filter((t) => t.startsWith('#')).map((t) => t.slice(1))

    const mentions = tokens.filter((t) => t.startsWith('@')).map((t) => t.slice(1))

    const cleanTokens = tokens.filter((t) => !t.startsWith('#') && !t.startsWith('@'))

    return { tokens: cleanTokens, hashtag_tokens, mentions }
  }

  /**
   * Xóa cache cũ để giải phóng bộ nhớ (gọi định kỳ nếu cần)
   */
  clearExpiredCache(): void {
    const now = Date.now()
    for (const [key, entry] of this.tokenCache.entries()) {
      if (entry.expiredAt <= now) {
        this.tokenCache.delete(key)
      }
    }
  }
}

const nlpService = new NLPService()
export default nlpService
