import { Router } from 'express';
import { execSync } from 'child_process';

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

healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version,
    appName: process.env.APP_NAME || 'Chat App',
    appSlug: process.env.APP_SLUG || 'chat-app',
  });
});
