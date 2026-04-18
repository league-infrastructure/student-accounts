import { Router } from 'express';

export const adminEnvRouter = Router();

adminEnvRouter.get('/env', async (req, res) => {
  const prisma = req.services.prisma;
  const config = req.services.config;

  let dbStatus = 'disconnected';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  res.json({
    node: process.version,
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
    },
    deployment: process.env.NODE_ENV || 'development',
    database: dbStatus,
    integrations: {
      github: {
        configured: !!(config.get('GITHUB_CLIENT_ID') && config.get('GITHUB_CLIENT_SECRET')),
      },
      google: {
        configured: !!(config.get('GOOGLE_CLIENT_ID') && config.get('GOOGLE_CLIENT_SECRET')),
      },
      pike13: {
        configured: !!(config.get('PIKE13_CLIENT_ID') && config.get('PIKE13_CLIENT_SECRET')),
      },
      githubToken: {
        configured: !!config.get('GITHUB_TOKEN'),
      },
      anthropic: {
        configured: !!config.get('ANTHROPIC_API_KEY'),
      },
      openai: {
        configured: !!config.get('OPENAI_API_KEY'),
      },
    },
  });
});
