/**
 * Log thống nhất cho pipeline gợi ý bài viết.
 * Trên terminal: grep theo `[Gợi ý]` để xem toàn bộ luồng.
 *
 * @param tier - Nhóm: API | Orchestrator | ContentBased | CF | NLP
 * @param message - Mô tả bước (tiếng Việt)
 * @param data - Thông tin bổ sung (object, optional)
 */
export function recoLog(tier: string, message: string, data?: Record<string, unknown>): void {
  const prefix = `[Gợi ý][${tier}]`
  if (data !== undefined && Object.keys(data).length > 0) {
    console.log(prefix, message, data)
  } else {
    console.log(prefix, message)
  }
}
