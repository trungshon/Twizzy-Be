import { Request, Response, NextFunction } from 'express'
import mediaService from '~/services/medias.services'
import { USER_MESSAGES } from '~/constants/messages'
import path from 'path'
import { UPLOAD_IMAGE_DIR, UPLOAD_VIDEO_DIR } from '~/constants/dir'
import { HTTP_STATUS } from '~/constants/httpStatus'
import fs from 'fs'
import mime from 'mime'

export const uploadImageController = async (req: Request, res: Response, next: NextFunction) => {
  const url = await mediaService.uploadImage(req)
  return res.json({
    message: USER_MESSAGES.UPLOAD_IMAGE_SUCCESSFULLY,
    result: url
  })
}

export const serveImageController = (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params
  return res.sendFile(path.resolve(UPLOAD_IMAGE_DIR, name), (err) => {
    if (err) {
      res.status((err as any).status).send('Not found')
    }
  })
}

export const uploadVideoController = async (req: Request, res: Response, next: NextFunction) => {
  const url = await mediaService.uploadVideo(req)
  return res.json({
    message: USER_MESSAGES.UPLOAD_VIDEO_SUCCESSFULLY,
    result: url
  })
}

export const serveVideoStreamController = (req: Request, res: Response, next: NextFunction) => {
  const { name } = req.params
  const videoPath = path.resolve(UPLOAD_VIDEO_DIR, name)

  // Kiểm tra file tồn tại
  if (!fs.existsSync(videoPath)) {
    return res.status(HTTP_STATUS.NOT_FOUND).send('Video not found')
  }

  const videoSize = fs.statSync(videoPath).size
  const contentType = mime.getType(videoPath) || 'video/mp4'
  const range = req.headers.range

  // Nếu không có Range header, serve toàn bộ file (cần thiết cho một số player)
  if (!range) {
    const headers = {
      'Content-Length': videoSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    }
    res.writeHead(HTTP_STATUS.OK, headers)
    fs.createReadStream(videoPath).pipe(res)
    return
  }

  // Parse Range header đúng cách: "bytes=start-end" hoặc "bytes=start-"
  const parts = range.replace(/bytes=/, '').split('-')
  const start = parseInt(parts[0], 10) || 0

  // Nếu client chỉ định end, dùng end đó; nếu không, serve toàn bộ file từ start
  // Điều này quan trọng để ExoPlayer có thể request moov atom ở cuối file
  let end: number
  if (parts[1] && parts[1].length > 0) {
    end = parseInt(parts[1], 10)
  } else {
    // Khi client request "bytes=0-", serve toàn bộ file còn lại
    // Thay vì chunk 1MB, để ExoPlayer tự quản lý buffering
    end = videoSize - 1
  }

  // Đảm bảo end không vượt quá file size
  end = Math.min(end, videoSize - 1)

  // Validate range
  if (start >= videoSize || start > end || start < 0) {
    res.writeHead(416, {
      'Content-Range': `bytes */${videoSize}`
    })
    return res.end()
  }

  const contentLength = end - start + 1
  const headers = {
    'Content-Range': `bytes ${start}-${end}/${videoSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': contentLength,
    'Content-Type': contentType
  }

  res.writeHead(HTTP_STATUS.PARTIAL_CONTENT, headers)
  const videoStream = fs.createReadStream(videoPath, { start, end })
  videoStream.pipe(res)
}
