/**
 * GET /api/account/events — Server-Sent Events stream for live student updates.
 *
 * When an admin approves/rejects a provisioning request, grants/revokes an
 * LLM proxy token, or approves/denies a pending account, the student's
 * EventSource connection receives an `event: account-updated` frame, which
 * triggers a re-fetch of their account data via React Query invalidation.
 *
 * Auth: requires authentication (any role). Scoped to the signed-in user's
 * userId via req.session.
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { userBus } from '../services/change-bus.js';

export const accountEventsRouter = Router();

const HEARTBEAT_INTERVAL_MS = 25_000;

accountEventsRouter.get(
  '/events',
  requireAuth,
  (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Initial marker — tells the client the stream is live.
    res.write(`event: ready\ndata: {}\n\n`);

    const onChange = () => {
      res.write(`event: account-updated\ndata: {}\n\n`);
    };
    userBus.on(`user-${userId}`, onChange);

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      userBus.off(`user-${userId}`, onChange);
    };
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('close', cleanup);
  },
);
