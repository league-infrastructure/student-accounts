import { Router } from 'express';

export const adminLogsRouter = Router();

adminLogsRouter.get('/logs', (req, res) => {
  const levelParam = req.query.level as string | undefined;
  const minLevel = levelParam ? parseInt(levelParam, 10) : undefined;

  const logs = req.services.logs;
  const entries = logs.getEntries(
    minLevel && !isNaN(minLevel) ? minLevel : undefined,
  );

  res.json({ entries, total: logs.size });
});
