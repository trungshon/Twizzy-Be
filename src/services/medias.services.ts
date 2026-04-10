import { Request } from 'express'
import { getNameFromFullname, handleUploadImage, handleUploadVideo } from '~/utils/file'
import { UPLOAD_IMAGE_DIR } from '~/constants/dir'
import path from 'path'
import fs from 'fs'
import { isProduction } from '~/constants/config'
import { config } from 'dotenv'
import { MediaType } from '~/constants/enum'
import { Media } from '~/models/Other'
import { v2 as cloudinary } from 'cloudinary'
import moderationService from './moderation.services'
import { ErrorWithStatus } from '~/models/Errors'
import { HTTP_STATUS } from '~/constants/httpStatus'
config()

// Khởi tạo Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

class MediaService {
  async uploadImage(req: Request) {
    const files = await handleUploadImage(req)
    const result: Media[] = await Promise.all(
      files.map(async (file) => {
        const newName = getNameFromFullname(file.newFilename)

        // BƯỚC 1: Kiểm duyệt ảnh cục bộ trước khi upload (nếu không skip)
        const skipModeration = req.query.moderation === 'false' || process.env.MODERATE_IMAGE === 'false'
        if (!skipModeration) {
          const moderationResult = await moderationService.moderateImage(file.filepath)
          if (!moderationResult.passed) {
            // Xóa file tạm
            if (fs.existsSync(file.filepath)) {
              fs.unlinkSync(file.filepath)
            }
            throw new ErrorWithStatus({
              message: `Ảnh vi phạm tiêu chuẩn cộng đồng: ${moderationResult.violations.map((v) => v.reason).join('; ')}`,
              status: HTTP_STATUS.BAD_REQUEST
            })
          }
        }

        // BƯỚC 2: Upload trực tiếp file gốc lên Cloudinary (chỉ khi đã qua kiểm duyệt)
        const uploadResult = await cloudinary.uploader.upload(file.filepath, {
          folder: 'twizzy/images', // Thư mục trên Cloudinary
          public_id: newName, // Tên file
          overwrite: true,
          resource_type: 'image'
        })

        // Xóa file local sau khi upload xong
        if (fs.existsSync(file.filepath)) {
          fs.unlinkSync(file.filepath)
        }

        return {
          url: uploadResult.secure_url, // URL từ Cloudinary CDN
          type: MediaType.Image
        }
      })
    )
    return result
  }

  async uploadVideo(req: Request) {
    const files = await handleUploadVideo(req)
    const result: Media[] = await Promise.all(
      files.map(async (file) => {
        // handleUploadVideo rename file thêm extension nhưng không cập nhật filepath
        // nên phải lấy đường dẫn thực tế (filepath + extension)
        const extension = file.newFilename.split('.').pop()
        const actualVideoPath = file.filepath + '.' + extension

        // BƯỚC 1: Kiểm duyệt video cục bộ trước khi upload (nếu không skip)
        const skipModeration = req.query.moderation === 'false' || process.env.MODERATE_VIDEO === 'false'
        if (!skipModeration) {
          const moderationResult = await moderationService.moderateVideo(actualVideoPath)
          if (!moderationResult.passed) {
            // Xóa file tạm
            if (fs.existsSync(actualVideoPath)) {
              fs.unlinkSync(actualVideoPath)
            }
            throw new ErrorWithStatus({
              message: `Video vi phạm tiêu chuẩn cộng đồng: ${moderationResult.violations.map((v) => v.reason).join('; ')}`,
              status: HTTP_STATUS.BAD_REQUEST
            })
          }
        }

        // BƯỚC 2: Upload lên Cloudinary
        const uploadResult = await cloudinary.uploader.upload(actualVideoPath, {
          folder: 'twizzy/videos',
          public_id: getNameFromFullname(file.newFilename),
          overwrite: true,
          resource_type: 'video'
        })

        // Xóa file local sau khi upload xong
        fs.unlinkSync(actualVideoPath)

        return {
          url: uploadResult.secure_url, // URL từ Cloudinary CDN
          type: MediaType.Video
        }
      })
    )
    return result
  }

  async deleteMedia(url: string) {
    if (!url.includes('res.cloudinary.com')) return

    try {
      // Trích xuất public_id từ URL Cloudinary
      // Ví dụ: .../image/upload/f_auto,q_auto/v1712718765/twizzy/images/abc.jpg -> twizzy/images/abc
      const parts = url.split('/')
      const uploadIndex = parts.indexOf('upload')
      if (uploadIndex === -1) return

      // Bỏ qua tất cả các phần transformations và version
      // Public ID của chúng ta luôn bắt đầu bằng 'twizzy/'
      const twizzyIndex = parts.indexOf('twizzy')
      if (twizzyIndex === -1) return

      const publicIdWithExt = parts.slice(twizzyIndex).join('/')
      const publicId = publicIdWithExt.split('.').slice(0, -1).join('.')
      const resourceType = url.includes('/video/') ? 'video' : 'image'

      console.log(`[MediaService] Đang xóa ${resourceType} trên Cloudinary: ${publicId}`)
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
    } catch (error) {
      console.error('[MediaService] Lỗi khi xóa media trên Cloudinary:', error)
    }
  }
}

export default new MediaService()
