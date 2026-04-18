import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';

export const countersRouter = Router();

// All counter endpoints require authentication.
countersRouter.use(requireAuth);

/** GET /api/counters — list all counters */
countersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const counters = await req.services.counter.list();
    res.json(counters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list counters' });
  }
});

/** POST /api/counters/:name/increment — increment (or auto-create) a counter */
countersRouter.post('/:name/increment', async (req: Request, res: Response) => {
  try {
    const name = String(req.params['name']);
    const counter = await req.services.counter.increment(name);
    res.json(counter);
  } catch (err) {
    res.status(500).json({ error: 'Failed to increment counter' });
  }
});
