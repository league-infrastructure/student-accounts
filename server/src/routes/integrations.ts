import { Router } from 'express';
import { getConfig } from '../services/config';

export const integrationsRouter = Router();

integrationsRouter.get('/integrations/status', (_req, res) => {
  res.json({
    github: {
      configured: !!(getConfig('GITHUB_CLIENT_ID') && getConfig('GITHUB_CLIENT_SECRET')),
    },
    google: {
      configured: !!(getConfig('GOOGLE_CLIENT_ID') && getConfig('GOOGLE_CLIENT_SECRET')),
    },
    pike13: {
      configured: !!(process.env.PIKE13_ACCESS_TOKEN ||
        (getConfig('PIKE13_CLIENT_ID') && getConfig('PIKE13_CLIENT_SECRET'))),
    },
    githubToken: {
      configured: !!getConfig('GITHUB_TOKEN'),
    },
    anthropic: {
      configured: !!getConfig('ANTHROPIC_API_KEY'),
    },
    openai: {
      configured: !!getConfig('OPENAI_API_KEY'),
    },
  });
});
