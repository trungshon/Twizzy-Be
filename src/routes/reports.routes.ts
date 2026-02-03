import { Router } from 'express'
import { createReportController, deleteReportController, getReportsController, handleReportController } from '~/controllers/reports.controllers'
import { accessTokenValidator, adminValidator } from '~/middlewares/users.middlewares'
import wrapRequestHandler from '~/utils/handlers'

const reportsRouter = Router()

/**
 * @description Create a report
 * @path /reports
 * @method POST
 * @header { Authorization: Bearer <access_token> }
 * @body { twizz_id: string, reason: ReportReason, description: string }
 */
reportsRouter.post('/', accessTokenValidator, wrapRequestHandler(createReportController))

/**
 * @description Get reports (Admin)
 * @path /reports
 * @method GET
 * @header { Authorization: Bearer <access_token> }
 */
reportsRouter.get('/', accessTokenValidator, adminValidator, wrapRequestHandler(getReportsController))

/**
 * @description Handle report (Admin)
 * @path /reports/:report_id
 * @method PATCH
 * @header { Authorization: Bearer <access_token> }
 * @body { action: 'delete' | 'ban' | 'ignore' | 'warn' }
 */
reportsRouter.patch('/:report_id', accessTokenValidator, adminValidator, wrapRequestHandler(handleReportController))

/**
 * @description Delete report (Admin)
 * @path /reports/:report_id
 * @method DELETE
 * @header { Authorization: Bearer <access_token> }
 */
reportsRouter.delete('/:report_id', accessTokenValidator, adminValidator, wrapRequestHandler(deleteReportController))

export default reportsRouter
