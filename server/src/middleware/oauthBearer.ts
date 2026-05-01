/**
 * oauthBearer — factory middleware for OAuth bearer token authentication.
 *
 * Usage:
 *   router.get('/v1/users', oauthBearer('users:read'), handler)
 *
 * Behavior:
 *  1. Reads the bearer token from Authorization: Bearer <token> header.
 *     Falls back to ?access_token= query param (RFC 6750 §2.3).
 *  2. SHA-256-hashes the incoming token and looks up the OAuthAccessToken row.
 *  3. Rejects (401 invalid_token) if: not found, expired, revoked, or the
 *     owning OAuthClient is disabled.
 *  4. If requiredScope is provided and not in the token's scopes → 403.
 *  5. On success: best-effort updates last_used_at, attaches req.oauth, calls next().
 *
 * The type augmentation for req.oauth lives in server/src/types/oauth.d.ts.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLogger } from '../services/logger.js';

const logger = createLogger('oauth-bearer');

export function oauthBearer(requiredScope?: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Extract raw token from header or query string.
    let rawToken: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    } else if (req.query.access_token && typeof req.query.access_token === 'string') {
      rawToken = req.query.access_token;
    }

    if (!rawToken) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing bearer token',
      });
    }

    // Validate the token through the service layer.
    const services = req.services;
    const validation = await services.oauthTokens.validate(rawToken);

    if (!validation) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token is invalid, expired, or revoked',
      });
    }

    // Scope check.
    if (requiredScope && !validation.scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: 'insufficient_scope',
        scope: requiredScope,
      });
    }

    // Best-effort last_used_at update — fire and forget.
    services.oauthTokens.updateLastUsed(validation.id);

    // Attach OAuth context to the request.
    req.oauth = {
      client_id: validation.client_id,
      oauth_client_id: validation.oauth_client_id,
      user_id: validation.user_id,
      scopes: validation.scopes,
    };

    next();
  };
}
