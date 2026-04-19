import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth';
import { requireRole } from '../../middleware/requireRole';
import { adminAuthRouter } from './auth';
import { adminEnvRouter } from './env';
import { adminDbRouter } from './db';
import { adminConfigRouter } from './config';
import { adminLogsRouter } from './logs';
import { adminSessionsRouter } from './sessions';
import { adminUsersRouter } from './users';
import { adminSchedulerRouter } from './scheduler';
import { adminBackupsRouter } from './backups';
import { adminProvisioningRequestsRouter } from './provisioning-requests';

export const adminRouter = Router();

// Auth routes (login/check don't require admin, logout does but is harmless)
adminRouter.use(adminAuthRouter);

// All other admin routes require authentication and admin role
adminRouter.use('/admin', requireAuth, requireRole('admin'));

// Protected admin routes
adminRouter.use('/admin', adminEnvRouter);
adminRouter.use('/admin', adminDbRouter);
adminRouter.use('/admin', adminConfigRouter);
adminRouter.use('/admin', adminLogsRouter);
adminRouter.use('/admin', adminSessionsRouter);
adminRouter.use('/admin', adminUsersRouter);
adminRouter.use('/admin', adminSchedulerRouter);
adminRouter.use('/admin', adminBackupsRouter);
adminRouter.use('/admin', adminProvisioningRequestsRouter);
