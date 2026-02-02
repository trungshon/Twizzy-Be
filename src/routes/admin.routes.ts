import { Router } from 'express'
import {
    getStatsController,
    getGrowthController,
    getUsersController,
    getUserDetailController,
    updateUserStatusController,
    deleteUserController,
    getTwizzsController,
    deleteTwizzController
} from '~/controllers/admin.controllers'
import { accessTokenValidator } from '~/middlewares/users.middlewares'
import { requireAdmin } from '~/middlewares/admin.middlewares'
import wrapRequestHandler from '~/utils/handlers'

const adminRouter = Router()

/**
 * All admin routes require authentication and admin role
 */
adminRouter.use(accessTokenValidator, requireAdmin)

/**
 * Dashboard
 */
// GET /admin/stats - Get dashboard statistics
adminRouter.get('/stats', wrapRequestHandler(getStatsController))

// GET /admin/growth - Get growth data for charts
adminRouter.get('/growth', wrapRequestHandler(getGrowthController))

/**
 * Users Management
 */
// GET /admin/users - Get users list with pagination
adminRouter.get('/users', wrapRequestHandler(getUsersController))

// GET /admin/users/:user_id - Get user detail
adminRouter.get('/users/:user_id', wrapRequestHandler(getUserDetailController))

// PATCH /admin/users/:user_id/status - Update user verify status
adminRouter.patch('/users/:user_id/status', wrapRequestHandler(updateUserStatusController))

// DELETE /admin/users/:user_id - Delete user
adminRouter.delete('/users/:user_id', wrapRequestHandler(deleteUserController))

/**
 * Twizzs Management
 */
// GET /admin/twizzs - Get twizzs list with pagination
adminRouter.get('/twizzs', wrapRequestHandler(getTwizzsController))

// DELETE /admin/twizzs/:twizz_id - Delete twizz
adminRouter.delete('/twizzs/:twizz_id', wrapRequestHandler(deleteTwizzController))

export default adminRouter
