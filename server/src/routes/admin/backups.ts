import { Router } from 'express';

export const adminBackupsRouter = Router();

// POST /backups — create a new backup
adminBackupsRouter.post('/backups', async (req, res, next) => {
  try {
    const result = await req.services.backups.createBackup();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /backups — list all backups
adminBackupsRouter.get('/backups', async (req, res, next) => {
  try {
    const backups = await req.services.backups.listBackups();
    res.json(backups);
  } catch (err) {
    next(err);
  }
});

// POST /backups/:id/restore — restore a backup (requires confirm: true)
adminBackupsRouter.post('/backups/:id/restore', async (req, res, next) => {
  try {
    if (!req.body.confirm) {
      return res.status(400).json({ error: 'Must send { confirm: true } to restore a backup' });
    }
    const result = await req.services.backups.restoreBackup(req.params.id);
    res.json(result);
  } catch (err: any) {
    if (err.message === 'Invalid filename') {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Backup not found' });
    }
    next(err);
  }
});

// DELETE /backups/:id — delete a backup
adminBackupsRouter.delete('/backups/:id', async (req, res, next) => {
  try {
    await req.services.backups.deleteBackup(req.params.id);
    res.json({ success: true });
  } catch (err: any) {
    if (err.message === 'Invalid filename') {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Backup not found' });
    }
    next(err);
  }
});

// GET /export/json — export all data as JSON
adminBackupsRouter.get('/export/json', async (req, res, next) => {
  try {
    const data = await req.services.backups.exportJson();
    const filename = `export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});
