import express from 'express'
import usersRouter from './routes/users.routes'
import databaseService from './services/database.services'
import defaultErrorHandler from './middlewares/error.middlewares'
import mediasRouter from './routes/medias.routes'
import { initFolder } from './utils/file'
import { config } from 'dotenv'
import staticRouter from './routes/static.routes'
import twizzsRouter from './routes/twizzs.routes'
import bookmarksRouter from './routes/bookmarks.routes'
import likesRouter from './routes/likes.routes'
// import './utils/fake'

config()
databaseService.connect().then(() => {
  databaseService.indexUsers()
  databaseService.indexRefreshTokens()
  databaseService.indexFollowers()
})
const app = express()
const PORT = process.env.PORT || 3000

initFolder()
app.use(express.json())
app.use('/users', usersRouter)
app.use('/medias', mediasRouter)
app.use('/twizzs', twizzsRouter)
app.use('/bookmarks', bookmarksRouter)
app.use('/likes', likesRouter)
app.use('/static', staticRouter)
// app.use('/static', express.static(UPLOAD_IMAGE_DIR))
app.use(defaultErrorHandler)
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
