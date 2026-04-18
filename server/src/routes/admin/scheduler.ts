import { Router } from 'express';

export const adminSchedulerRouter = Router();

// GET /admin/scheduler/jobs — list all scheduled jobs
adminSchedulerRouter.get('/scheduler/jobs', async (req, res, next) => {
  try {
    const jobs = await req.services.scheduler.listJobs();
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// PUT /admin/scheduler/jobs/:id — update a job (enable/disable)
adminSchedulerRouter.put('/scheduler/jobs/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const updated = await req.services.scheduler.updateJob(id, req.body);
    res.json(updated);
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Job not found' });
    }
    next(err);
  }
});

// POST /admin/scheduler/jobs/:id/run — trigger immediate execution
adminSchedulerRouter.post('/scheduler/jobs/:id/run', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const result = await req.services.scheduler.runJobNow(id);
    res.json(result);
  } catch (err: any) {
    if (err.message === 'Job not found') {
      return res.status(404).json({ error: 'Job not found' });
    }
    next(err);
  }
});
