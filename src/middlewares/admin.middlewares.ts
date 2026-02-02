import { NextFunction, Request, Response } from 'express'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { UserRole } from '~/constants/enum'
import { ErrorWithStatus } from '~/models/Errors'
import { TokenPayload } from '~/models/requests/User.requests'
import databaseService from '~/services/database.services'
import { ObjectId } from 'mongodb'

export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user_id } = req.decoded_authorization as TokenPayload

        const user = await databaseService.users.findOne({ _id: new ObjectId(user_id) })

        if (!user) {
            throw new ErrorWithStatus({
                message: 'User not found',
                status: HTTP_STATUS.NOT_FOUND
            })
        }

        if (user.role !== UserRole.Admin) {
            throw new ErrorWithStatus({
                message: 'Admin access required',
                status: HTTP_STATUS.FORBIDDEN
            })
        }

        next()
    } catch (error) {
        next(error)
    }
}
