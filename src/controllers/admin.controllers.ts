import { Request, Response, NextFunction } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import adminService from '~/services/admin.services'
import { HTTP_STATUS } from '~/constants/httpStatus'
import { UserVerifyStatus } from '~/constants/enum'

// Dashboard
export const getStatsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await adminService.getStats()
        return res.json({
            message: 'Get stats successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const getGrowthController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const days = parseInt(req.query.days as string) || 7
        const offset = parseInt(req.query.offset as string) || 0
        const result = await adminService.getGrowthData(days, offset)
        return res.json({
            message: 'Get growth data successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

// Users Management
export const getUsersController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1
        const limit = parseInt(req.query.limit as string) || 10
        const search = req.query.search as string || ''
        const verify_status = req.query.verify_status !== undefined
            ? parseInt(req.query.verify_status as string)
            : undefined

        const result = await adminService.getUsers({ page, limit, search, verify_status })
        return res.json({
            message: 'Get users successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const getUserDetailController = async (
    req: Request<ParamsDictionary>,
    res: Response,
    next: NextFunction
) => {
    try {
        const { user_id } = req.params
        const result = await adminService.getUserDetail(user_id)

        if (!result) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found'
            })
        }

        return res.json({
            message: 'Get user detail successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const updateUserStatusController = async (
    req: Request<ParamsDictionary>,
    res: Response,
    next: NextFunction
) => {
    try {
        const { user_id } = req.params
        const { verify } = req.body as { verify: UserVerifyStatus }

        const success = await adminService.updateUserStatus(user_id, verify)

        if (!success) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                message: 'User not found or update failed'
            })
        }

        return res.json({
            message: 'Update user status successfully'
        })
    } catch (error) {
        next(error)
    }
}

export const deleteUserController = async (
    req: Request<ParamsDictionary>,
    res: Response,
    next: NextFunction
) => {
    try {
        const { user_id } = req.params
        await adminService.deleteUser(user_id)

        return res.json({
            message: 'Delete user successfully'
        })
    } catch (error) {
        next(error)
    }
}

// Twizzs Management
export const getTwizzsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1
        const limit = parseInt(req.query.limit as string) || 10
        const search = req.query.search as string || ''
        const type = req.query.type !== undefined
            ? parseInt(req.query.type as string)
            : undefined

        const result = await adminService.getTwizzs({ page, limit, search, type })
        return res.json({
            message: 'Get twizzs successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const deleteTwizzController = async (
    req: Request<ParamsDictionary>,
    res: Response,
    next: NextFunction
) => {
    try {
        const { twizz_id } = req.params
        await adminService.deleteTwizz(twizz_id)

        return res.json({
            message: 'Delete twizz successfully'
        })
    } catch (error) {
        next(error)
    }
}
