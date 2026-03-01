import { Request } from 'express'
import { getNameFromFullname, handleUploadImage, handleUploadVideo } from '~/utils/file'
import sharp from 'sharp'
import { UPLOAD_IMAGE_DIR } from '~/constants/dir'
import path from 'path'
import fs from 'fs'
import { isProduction } from '~/constants/config'
import { config } from 'dotenv'
import { MediaType } from '~/constants/enum'
import { Media } from '~/models/Other'
import { v2 as cloudinary } from 'cloudinary'
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
        // Dùng sharp chuyển sang jpg trước khi upload
        const jpegPath = path.resolve(UPLOAD_IMAGE_DIR, `${newName}.jpg`)
        await sharp(file.filepath).jpeg().toFile(jpegPath)
        // Xóa file temp gốc
        fs.unlinkSync(file.filepath)

        // Upload lên Cloudinary
        const uploadResult = await cloudinary.uploader.upload(jpegPath, {
          folder: 'twizzy/images', // Thư mục trên Cloudinary
          public_id: newName, // Tên file
          overwrite: true,
          resource_type: 'image'
        })

        // Xóa file local sau khi upload xong
        fs.unlinkSync(jpegPath)

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

        // Upload lên Cloudinary
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
}

export default new MediaService()
