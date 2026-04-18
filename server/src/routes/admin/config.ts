import { Router } from 'express';

export const adminConfigRouter = Router();

adminConfigRouter.get('/config', (req, res) => {
  res.json(req.services.config.getAll());
});

adminConfigRouter.put('/config', async (req, res, next) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string' || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value are required strings' });
    }

    const result = await req.services.config.set(key, value);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Unknown config key')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

adminConfigRouter.get('/config/export', (req, res) => {
  const content = req.services.config.export();
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=config-export.env');
  res.send(content);
});
