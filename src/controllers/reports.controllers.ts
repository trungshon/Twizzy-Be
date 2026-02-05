import { Request, Response, NextFunction } from 'express'
import { ParamsDictionary } from 'express-serve-static-core'
import reportsService from '~/services/reports.services'
import { TokenPayload } from '~/models/requests/User.requests'

export const createReportController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user_id } = req.decoded_authorization as TokenPayload
        const { twizz_id, reason, description } = req.body
        const result = await reportsService.createReport({
            user_id,
            twizz_id,
            reason,
            description
        })
        return res.json({
            message: 'Report created successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const getReportsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const page = parseInt(req.query.page as string) || 1
        const limit = parseInt(req.query.limit as string) || 10
        const status = req.query.status ? parseInt(req.query.status as string) : undefined
        const result = await reportsService.getReports({ page, limit, status })
        return res.json({
            message: 'Get reports successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const handleReportController = async (
    req: Request<ParamsDictionary>,
    res: Response,
    next: NextFunction
) => {
    try {
        const { report_id } = req.params
        const { action } = req.body
        const { user_id } = req.decoded_authorization as TokenPayload
        const result = await reportsService.handleReport({
            report_id,
            action,
            admin_id: user_id
        })
        return res.json({
            message: 'Handle report successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}
export const deleteReportController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { report_id } = req.params
        const result = await reportsService.deleteReport(report_id)
        return res.json({
            message: 'Delete report successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}
export const deleteProcessedReportsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await reportsService.deleteProcessedReports()
        return res.json({
            message: 'Delete processed reports successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const getMyReportsController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user_id } = req.decoded_authorization as TokenPayload
        const page = parseInt(req.query.page as string) || 1
        const limit = parseInt(req.query.limit as string) || 10
        const result = await reportsService.getMyReports({ user_id, page, limit })
        return res.json({
            message: 'Get my reports successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}

export const getReportsAgainstMeController = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { user_id } = req.decoded_authorization as TokenPayload
        const page = parseInt(req.query.page as string) || 1
        const limit = parseInt(req.query.limit as string) || 10
        const result = await reportsService.getReportsAgainstMe({ user_id, page, limit })
        return res.json({
            message: 'Get reports against me successfully',
            result
        })
    } catch (error) {
        next(error)
    }
}
