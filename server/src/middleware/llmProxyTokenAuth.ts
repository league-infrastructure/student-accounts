/**
 * llmProxyTokenAuth — bearer-token auth for the /proxy/v1/* routes
 * (Sprint 013 T004).
 *
 * Reads `Authorization: Bearer <token>` from the request, asks
 * `req.services.llmProxyTokens.validate()` to confirm the token is active,
 * not expired, and within quota, then attaches the loaded row to
 * `res.locals.llmProxyToken` for downstream handlers. Typed errors from
 * the service are translated to HTTP status codes:
 *
 *  - LlmProxyTokenUnauthorizedError → 401 (missing / unknown / revoked /
 *    expired).
 *  - LlmProxyTokenQuotaExceededError → 429 (quota exhausted).
 */

import { Request, Response, NextFunction } from 'express';
import {
  LlmProxyTokenUnauthorizedError,
  LlmProxyTokenQuotaExceededError,
} from '../services/llm-proxy-token.service.js';
import type { LlmProxyToken } from '../generated/prisma/client.js';

/** Extract the token from an `Authorization: Bearer …` header. */
function parseBearer(header: string | undefined): string | null {
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function llmProxyTokenAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = parseBearer(req.header('authorization'));
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed bearer token' });
    return;
  }

  try {
    const row = await req.services.llmProxyTokens.validate(token);
    (res.locals as { llmProxyToken?: LlmProxyToken }).llmProxyToken = row;
    next();
  } catch (err) {
    if (err instanceof LlmProxyTokenQuotaExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    if (err instanceof LlmProxyTokenUnauthorizedError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  }
}
