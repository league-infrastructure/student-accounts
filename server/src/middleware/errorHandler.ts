import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors.js';
import { createLogger } from '../services/logger.js';

const logger = createLogger('errorHandler');

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
  logger.error(
    {
      method: req.method,
      url: req.originalUrl,
      err: { message: err?.message, stack: err?.stack, name: err?.name },
    },
    'Unhandled error in request handler',
  );
  res.status(500).json({ error: 'Internal server error' });
}
