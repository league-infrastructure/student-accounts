import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';
import { logBuffer } from '../services/logBuffer.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const payload = {
    level: 50,
    time: Date.now(),
    name: 'errorHandler',
    method: req.method,
    url: req.originalUrl,
    err: { message: err?.message, stack: err?.stack, name: err?.name },
    msg: 'Unhandled error in request handler',
  };
  const line = JSON.stringify(payload);
  console.error(line);
  logBuffer.ingest(line + '\n');
  res.status(500).json({ error: 'Internal server error' });
}
