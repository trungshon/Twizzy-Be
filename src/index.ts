import express from 'express'
import cors from 'cors'
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
import searchRouter from './routes/search.routes'
import notificationsRouter from './routes/notifications.routes'
import adminRouter from './routes/admin.routes'
import path from 'path'

import { createServer } from 'http'

import conversationsRouter from './routes/conversations.routes'
import initSocket from './utils/socket'
import reportsRouter from './routes/reports.routes'

// import './utils/fake'

config()
databaseService.connect().then(() => {
  databaseService.indexUsers()
  databaseService.indexRefreshTokens()
  databaseService.indexFollowers()
  databaseService.indexTwizzs()
})
const app = express()
const httpServer = createServer(app)
const PORT = process.env.PORT || 3000

initFolder()
app.use(cors())
app.use(express.json())
app.use('/users', usersRouter)
app.use('/medias', mediasRouter)
app.use('/twizzs', twizzsRouter)
app.use('/bookmarks', bookmarksRouter)
app.use('/likes', likesRouter)
app.use('/search', searchRouter)
app.use('/static', staticRouter)
app.use('/conversations', conversationsRouter)
app.use('/notifications', notificationsRouter)
app.use('/admin', adminRouter)
app.use('/reports', reportsRouter)

// Serve admin web static files
app.use('/admin-web', express.static(path.join(__dirname, '../admin')))
app.get('/admin-web/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin', 'index.html'))
})

app.use(defaultErrorHandler)

initSocket(httpServer)
httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})

