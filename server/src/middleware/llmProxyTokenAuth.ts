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

/**
 * Resolve the proxy token. Accept either:
 *  - `x-api-key: <token>` (what the Anthropic SDK / Claude Code send
 *    when `ANTHROPIC_API_KEY` is set). Checked first because Claude
 *    Code frequently ships *both* headers — `Authorization` may carry
 *    a stale claude.ai oauth token that isn't for us.
 *  - `Authorization: Bearer <token>` (the standard HTTP bearer flow,
 *    useful for curl-style clients).
 *
 * We also require the token value to look like ours (llmp_ prefix) so
 * a claude.ai oauth token accidentally reaching us gets a clean 401
 * instead of a DB hash lookup miss.
 */
function extractProxyToken(req: Request): string | null {
  const apiKey = req.header('x-api-key');
  if (typeof apiKey === 'string') {
    const v = apiKey.trim();
    if (v.startsWith('llmp_')) return v;
  }
  const bearer = parseBearer(req.header('authorization'));
  if (bearer && bearer.startsWith('llmp_')) return bearer;
  // Fall back to whichever value we have, so the service throws the
  // normal "invalid token" error rather than a "missing token" error.
  if (typeof apiKey === 'string' && apiKey.trim().length > 0) return apiKey.trim();
  if (bearer) return bearer;
  return null;
}

export async function llmProxyTokenAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractProxyToken(req);
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
