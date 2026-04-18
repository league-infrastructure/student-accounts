import { Router } from 'express';
import { requireAdmin } from '../../middleware/requireAdmin';
import { adminAuthRouter } from './auth';
import { adminEnvRouter } from './env';
import { adminDbRouter } from './db';
import { adminConfigRouter } from './config';
import { adminLogsRouter } from './logs';
import { adminSessionsRouter } from './sessions';
import { adminUsersRouter } from './users';
import { adminSchedulerRouter } from './scheduler';
import { adminBackupsRouter } from './backups';

export const adminRouter = Router();

// Auth routes (login/check don't require admin, logout does but is harmless)
adminRouter.use(adminAuthRouter);

// All other admin routes require authentication
adminRouter.use('/admin', requireAdmin);

// Protected admin routes
adminRouter.use('/admin', adminEnvRouter);
adminRouter.use('/admin', adminDbRouter);
adminRouter.use('/admin', adminConfigRouter);
adminRouter.use('/admin', adminLogsRouter);
adminRouter.use('/admin', adminSessionsRouter);
adminRouter.use('/admin', adminUsersRouter);
adminRouter.use('/admin', adminSchedulerRouter);
adminRouter.use('/admin', adminBackupsRouter);
