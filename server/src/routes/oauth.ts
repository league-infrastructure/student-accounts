/**
 * OAuth routes — mounted at /oauth (NOT /api/oauth).
 *
 * External clients are not internal API consumers, so they live at the bare
 * /oauth namespace per architecture-update.md.
 *
 * Sprint 018: client_credentials grant only.
 * Sprint 019: adds authorization_code, refresh_token grants; /authorize;
 *             /authorize/consent; /userinfo.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { oauthBearer } from '../middleware/oauthBearer.js';
import { matchesRedirectUri } from '../services/oauth/redirect-matcher.js';
import { OAuthError } from '../services/oauth/oauth-code.service.js';
import { prisma } from '../services/prisma.js';

export const oauthRouter = Router();

// ---------------------------------------------------------------------------
// Parse form-encoded bodies on this router (for POST /authorize/consent)
// ---------------------------------------------------------------------------
import express from 'express';
oauthRouter.use(express.urlencoded({ extended: false }));

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

    // Validate grant_type before credential check.
    if (!grant_type) {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    if (!['client_credentials', 'authorization_code', 'refresh_token'].includes(grant_type)) {
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

    // ---- grant_type = client_credentials ----
    if (grant_type === 'client_credentials') {
      const allowedScopes = services.oauthClients.sanitize(client).allowed_scopes;
      let requestedScopes: string[] = allowedScopes;

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
      return res.json(result);
    }

    // ---- grant_type = authorization_code ----
    if (grant_type === 'authorization_code') {
      const { code, redirect_uri, code_verifier } = body;
      if (!code || !redirect_uri || !code_verifier) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'code, redirect_uri, and code_verifier are required' });
      }

      let consumed;
      try {
        consumed = await services.oauthCodes.consume({ code, redirect_uri, code_verifier });
      } catch (err: any) {
        if (err?.code) return res.status(400).json({ error: err.code });
        throw err;
      }

      // Cross-check: code must belong to this client.
      if (consumed.oauth_client_id !== client.id) {
        return res.status(400).json({ error: 'invalid_grant', error_description: 'Code does not belong to this client' });
      }

      // Mint access token with user context.
      const accessResult = await services.oauthTokens.issueForUser({
        oauthClientId: client.id,
        clientId: client.client_id,
        userId: consumed.user_id,
        scopes: consumed.scopes,
      });

      // Mint refresh token.
      const { token: refresh_token } = await services.oauthRefreshTokens.mint({
        client_id: client.id,
        user_id: consumed.user_id,
        scopes: consumed.scopes,
      });

      return res.json({
        access_token: accessResult.access_token,
        token_type: 'Bearer',
        expires_in: accessResult.expires_in,
        refresh_token,
        scope: consumed.scopes.join(' '),
      });
    }

    // ---- grant_type = refresh_token ----
    if (grant_type === 'refresh_token') {
      const { refresh_token } = body;
      if (!refresh_token) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token is required' });
      }

      let rotated;
      try {
        rotated = await services.oauthRefreshTokens.rotate({ token: refresh_token });
      } catch (err: any) {
        if (err?.code === 'invalid_client') return res.status(401).json({ error: err.code });
        if (err?.code) return res.status(400).json({ error: err.code });
        throw err;
      }

      return res.json({
        access_token: rotated.access_token,
        token_type: 'Bearer',
        expires_in: rotated.expires_in,
        refresh_token: rotated.refresh_token,
        scope: rotated.scopes.join(' '),
      });
    }

    // Should not reach here.
    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/userinfo — OIDC-shaped subset (Sprint 019 ticket 008)
//
// Protected by oauthBearer('profile'). Requires a user-context token
// (user_id !== null). Returns { sub, email, name, role }.
// ---------------------------------------------------------------------------

oauthRouter.get('/userinfo', oauthBearer('profile'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const oauth = req.oauth!;

    // Client-credentials tokens (user_id = null) are not allowed here.
    if (oauth.user_id === null) {
      return res.status(404).json({
        error: 'invalid_token',
        error_description: 'This token is not associated with a user',
      });
    }

    const user = await prisma.user.findUnique({ where: { id: oauth.user_id } });
    if (!user) {
      return res.status(404).json({
        error: 'invalid_token',
        error_description: 'User not found',
      });
    }

    // Audit — fire-and-forget.
    const services = req.services;
    prisma.$transaction(async (tx: any) => {
      await services.audit.record(tx, {
        actor_user_id: oauth.user_id,
        action: 'oauth_userinfo_call',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(oauth.oauth_client_id),
        details: { oauth_client_id: oauth.oauth_client_id },
      });
    }).catch(() => {/* best-effort */});

    return res.json({
      sub: String(user.id),
      email: user.primary_email,
      name: user.display_name,
      role: user.role,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /oauth/authorize — authorization-code flow (Sprint 019 ticket 005)
// ---------------------------------------------------------------------------

oauthRouter.get('/authorize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = req.query as Record<string, string>;
    const services = req.services;

    // --- Validate response_type ---
    if (q.response_type !== 'code') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'response_type must be code' });
    }

    // --- Validate client_id ---
    const clientIdStr = q.client_id;
    if (!clientIdStr) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
    }
    const clientRow = await services.oauthClients.findByClientId(clientIdStr);
    if (!clientRow || clientRow.disabled_at !== null) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown or disabled client' });
    }
    const client = services.oauthClients.sanitize(clientRow);

    // --- Validate redirect_uri FIRST (security: never redirect to unvalidated URI) ---
    const redirectUri = q.redirect_uri;
    if (!redirectUri) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is required' });
    }
    if (!matchesRedirectUri(client.redirect_uris, redirectUri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not allowed' });
    }

    // --- Validate code_challenge and code_challenge_method ---
    const codeChallenge = q.code_challenge;
    const codeChallengeMethod = q.code_challenge_method;
    if (!codeChallenge) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge is required' });
    }
    if (codeChallengeMethod !== 'S256') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge_method must be S256' });
    }

    // --- Scope negotiation ---
    const requestedRaw = (q.scope ?? '').split(/\s+/).filter(Boolean);
    const grantedScopes = requestedRaw.length > 0
      ? requestedRaw.filter((s) => client.allowed_scopes.includes(s))
      : client.allowed_scopes;
    if (grantedScopes.length === 0) {
      return res.status(400).json({ error: 'invalid_scope', error_description: 'No allowed scopes in request' });
    }

    const state = q.state ?? '';
    const session = req.session as any;
    const userId: number | null = session.userId ?? null;

    // Audit helper.
    const auditOutcome = async (outcome: string) => {
      try {
        await prisma.$transaction(async (tx: any) => {
          await services.audit.record(tx, {
            actor_user_id: userId,
            action: 'oauth_authorize_attempt',
            target_entity_type: 'OAuthClient',
            target_entity_id: String(client.id),
            details: { oauth_client_id: client.id, scopes: grantedScopes, outcome },
          });
        });
      } catch { /* best-effort */ }
    };

    // --- Branch 1: not authenticated → redirect to login ---
    if (!userId) {
      await auditOutcome('redirect_to_login');
      const nextUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(302, `/login?next=${nextUrl}`);
    }

    // --- Branch 2: authenticated, check consent ---
    const consent = await services.oauthConsents.find({
      user_id: userId,
      client_id: client.id,
      scopes: grantedScopes,
    });

    if (consent) {
      // Consent on file — mint code and redirect.
      const { code } = await services.oauthCodes.mint({
        client_id: client.id,
        user_id: userId,
        redirect_uri: redirectUri,
        scopes: grantedScopes,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
      await auditOutcome('redirect_with_code');
      const redirectUrl = buildRedirectWithCode(redirectUri, code, state);
      return res.redirect(302, redirectUrl);
    }

    // --- Branch 3: authenticated, no consent → show consent page ---
    await auditOutcome('prompt_consent');
    const params = new URLSearchParams({
      client_id: clientIdStr,
      redirect_uri: redirectUri,
      scope: grantedScopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      client_name: client.name,
      client_description: client.description ?? '',
    });
    return res.redirect(302, `/oauth/consent?${params.toString()}`);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth/authorize/consent — process consent form (Sprint 019 ticket 006)
// ---------------------------------------------------------------------------

oauthRouter.post('/authorize/consent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as Record<string, string>;
    const services = req.services;
    const session = req.session as any;
    const userId: number | null = session.userId ?? null;

    // Must be authenticated.
    if (!userId) {
      return res.status(401).json({ error: 'invalid_request', error_description: 'Not authenticated' });
    }

    // Re-validate client (form fields are user-controlled).
    const clientIdStr = body.client_id;
    if (!clientIdStr) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'client_id is required' });
    }
    const clientRow = await services.oauthClients.findByClientId(clientIdStr);
    if (!clientRow || clientRow.disabled_at !== null) {
      return res.status(401).json({ error: 'invalid_client', error_description: 'Unknown or disabled client' });
    }
    const client = services.oauthClients.sanitize(clientRow);

    // Re-validate redirect_uri.
    const redirectUri = body.redirect_uri;
    if (!redirectUri || !matchesRedirectUri(client.redirect_uris, redirectUri)) {
      return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not allowed' });
    }

    // Re-validate code_challenge_method.
    if (body.code_challenge_method !== 'S256') {
      return res.status(400).json({ error: 'invalid_request', error_description: 'code_challenge_method must be S256' });
    }

    // Re-validate scopes.
    const requestedScopes = (body.scopes ?? body.scope ?? '').split(/\s+/).filter(Boolean);
    const grantedScopes = requestedScopes.filter((s) => client.allowed_scopes.includes(s));
    if (grantedScopes.length === 0) {
      return res.status(400).json({ error: 'invalid_scope', error_description: 'No allowed scopes' });
    }

    const state = body.state ?? '';
    const decision = body.decision;

    if (decision === 'deny') {
      // Audit and redirect with error.
      await prisma.$transaction(async (tx: any) => {
        await services.audit.record(tx, {
          actor_user_id: userId,
          action: 'oauth_consent_denied',
          target_entity_type: 'OAuthClient',
          target_entity_id: String(client.id),
          details: { oauth_client_id: client.id, requested_scopes: grantedScopes },
        });
      });
      const denyUrl = buildRedirectWithError(redirectUri, 'access_denied', state);
      return res.redirect(302, denyUrl);
    }

    if (decision === 'allow') {
      // Record consent + mint code.
      await services.oauthConsents.record({
        user_id: userId,
        client_id: client.id,
        scopes: grantedScopes,
      });

      const { code } = await services.oauthCodes.mint({
        client_id: client.id,
        user_id: userId,
        redirect_uri: redirectUri,
        scopes: grantedScopes,
        code_challenge: body.code_challenge,
        code_challenge_method: 'S256',
      });

      await prisma.$transaction(async (tx: any) => {
        await services.audit.record(tx, {
          actor_user_id: userId,
          action: 'oauth_consent_granted',
          target_entity_type: 'OAuthClient',
          target_entity_id: String(client.id),
          details: { oauth_client_id: client.id, scopes: grantedScopes },
        });
      });

      const redirectUrl = buildRedirectWithCode(redirectUri, code, state);
      return res.redirect(302, redirectUrl);
    }

    return res.status(400).json({ error: 'invalid_request', error_description: 'decision must be allow or deny' });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// URL-building helpers (avoids string concatenation / injection)
// ---------------------------------------------------------------------------

function buildRedirectWithCode(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

function buildRedirectWithError(redirectUri: string, error: string, state: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}
