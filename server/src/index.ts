import './env.js';
import app from './app.js';
import { initPrisma, prisma } from './services/prisma.js';
import { initConfigCache } from './services/config.js';
import { ServiceRegistry } from './services/service.registry.js';
import {
  createWorkspaceDeleteJobHandler,
  WORKSPACE_DELETE_JOB_NAME,
} from './jobs/workspace-delete.job.js';

const port = parseInt(process.env.PORT || '3000', 10);

const registry = ServiceRegistry.create();

initPrisma().then(() => initConfigCache()).then(async () => {
  // seedDefaults upserts all scheduled job rows (daily-backup, weekly-backup,
  // workspace-delete) so they exist before handlers are registered.
  await registry.scheduler.seedDefaults();

  registry.scheduler.registerHandler('daily-backup', async () => {
    await registry.backups.createBackup();
  });
  registry.scheduler.registerHandler('weekly-backup', async () => {
    await registry.backups.createBackup();
  });

  // WorkspaceDeleteJob — hard-delete Workspace accounts past their scheduled date.
  registry.scheduler.registerHandler(
    WORKSPACE_DELETE_JOB_NAME,
    createWorkspaceDeleteJobHandler(prisma, registry.googleClient),
  );

  registry.scheduler.startTicking();

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
});

const shutdown = () => {
  registry.scheduler.stopTicking();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
