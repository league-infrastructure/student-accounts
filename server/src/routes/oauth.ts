/**
 * OAuth routes — mounted at /oauth (NOT /api/oauth).
 *
 * External clients are not internal API consumers, so they live at the bare
 * /oauth namespace per architecture-update.md.
 *
 * Sprint 018: client_credentials grant only.
 * Sprint 019 will add authorization_code + refresh_token.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';

export const oauthRouter = Router();

// ---------------------------------------------------------------------------
// POST /oauth/token — client_credentials grant
//
// Credentials may be provided two ways (RFC 6749 §2.3.1):
//   1. HTTP Basic auth: Authorization: Basic base64(client_id:secret)
//   2. Form fields: client_id + client_secret in the request body.
//
// Response follows the OAuth 2.0 spec:
//   { access_token, token_type: 'Bearer', expires_in, scope }
// ---------------------------------------------------------------------------

oauthRouter.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, string>;
    const grant_type = body.grant_type;

    if (grant_type !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }

    // Extract credentials from Basic auth header OR form body.
    let client_id: string | undefined;
    let client_secret: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
      const b64 = authHeader.slice(6);
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx > -1) {
        client_id = decoded.slice(0, colonIdx);
        client_secret = decoded.slice(colonIdx + 1);
      }
    } else {
      client_id = body.client_id;
      client_secret = body.client_secret;
    }

    if (!client_id || !client_secret) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    const services = req.services;
    const client = await services.oauthClients.verifySecret(client_id, client_secret);
    if (!client) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    // Scope negotiation: intersect requested scope with allowed_scopes.
    const allowedScopes = services.oauthClients.sanitize(client).allowed_scopes;
    let requestedScopes: string[] = allowedScopes; // default to all allowed scopes

    if (body.scope) {
      const requested = body.scope.split(/\s+/).filter(Boolean);
      requestedScopes = requested.filter((s) => allowedScopes.includes(s));
      if (requestedScopes.length === 0) {
        return res.status(400).json({ error: 'invalid_scope' });
      }
    }

    const result = await services.oauthTokens.issue({
      oauthClientId: client.id,
      clientId: client.client_id,
      scopes: requestedScopes,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
