import { Router } from 'express';
import { execSync } from 'child_process';
import { prisma } from '../services/prisma';

export const healthRouter = Router();

function getVersion(): string {
  if (process.env.APP_VERSION) {
    return process.env.APP_VERSION;
  }
  try {
    return execSync('git describe --tags --abbrev=0 HEAD 2>/dev/null', { encoding: 'utf-8' }).trim().replace(/^v/, '');
  } catch {
    return 'dev';
  }
}

const version = getVersion();

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'ok',
      version,
      appName: process.env.APP_NAME || 'Chat App',
      appSlug: process.env.APP_SLUG || 'chat-app',
    });
  } catch {
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
    });
  }
});
