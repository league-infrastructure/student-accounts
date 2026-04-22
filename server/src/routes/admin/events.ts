/**
 * GET /api/admin/events — Server-Sent Events stream for live admin updates.
 *
 * Replaces the 2-second polling on the Dashboard. The client opens a single
 * EventSource connection. The server holds it open and writes one
 * `event: <topic>` frame per change (pending-users, pending-requests) as
 * the change bus fires. Heartbeats every 25s keep intermediaries from
 * dropping the connection.
 *
 * Auth: mounted under /admin which already applies requireAuth +
 * requireRole('admin'), so every subscriber is a signed-in admin.
 */

import { Router } from 'express';
import { adminBus, type AdminChangeTopic } from '../../services/change-bus.js';

export const adminEventsRouter = Router();

const HEARTBEAT_INTERVAL_MS = 25_000;

adminEventsRouter.get('/events', (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Initial marker — tells the client the stream is live.
  res.write(`event: ready\ndata: {}\n\n`);

  const onChange = (topic: AdminChangeTopic) => {
    res.write(`event: ${topic}\ndata: {}\n\n`);
  };
  adminBus.on('change', onChange);

  const heartbeat = setInterval(() => {
    // Comment frames are invisible to the EventSource API but keep the
    // TCP connection alive through proxies that would otherwise time it
    // out.
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    adminBus.off('change', onChange);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
});
