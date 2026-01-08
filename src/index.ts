import express, { NextFunction, Request, Response } from 'express'
import usersRouter from './routes/users.routes'
import databaseService from './services/database.services'
const app = express()
const PORT = 3000
app.use(express.json())
app.use('/users', usersRouter)
databaseService.connect()
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  res.status(400).json({
    error: err.message
  })
})
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
