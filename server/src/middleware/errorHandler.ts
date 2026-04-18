import { Request, Response, NextFunction } from 'express';
import { ServiceError } from '../errors.js';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ServiceError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
