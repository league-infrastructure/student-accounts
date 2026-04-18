import { Request, Response, NextFunction } from 'express';
import { ServiceRegistry } from '../services/service.registry';

declare global {
  namespace Express {
    interface Request {
      services: ServiceRegistry;
    }
  }
}

/** Middleware that attaches a ServiceRegistry to each request. */
export function attachServices(registry: ServiceRegistry) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.services = registry;
    next();
  };
}
