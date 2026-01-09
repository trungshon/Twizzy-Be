import express from 'express'
import usersRouter from './routes/users.routes'
import databaseService from './services/database.services'
import defaultErrorHandler from './middlewares/error.middlewares'
databaseService.connect()
const app = express()
const PORT = 3000
app.use(express.json())
app.use('/users', usersRouter)
app.use(defaultErrorHandler)
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
