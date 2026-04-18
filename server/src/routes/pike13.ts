import { Router, Request, Response } from 'express';
import { findOrCreateOAuthUser } from './auth';

export const pike13Router = Router();

const PIKE13_AUTH_DOCS = 'https://developer.pike13.com/docs/authentication';

/**
 * Returns the base URL for Pike 13 API calls.
 * Defaults to the canonical pike13.com domain. Can be overridden with
 * PIKE13_API_BASE for subdomain-specific businesses
 * (e.g., https://mybusiness.pike13.com/api/v2/desk).
 */
function getApiBaseUrl(): string {
  return process.env.PIKE13_API_BASE || 'https://pike13.com/api/v2/desk';
}

/**
 * Returns the root authentication base URL derived from PIKE13_API_BASE,
 * or defaults to https://pike13.com.
 */
function getAuthBaseUrl(): string {
  const apiBase = process.env.PIKE13_API_BASE;
  if (apiBase) {
    return apiBase.replace('/api/v2/desk', '');
  }
  return 'https://pike13.com';
}

function callbackUrl(): string {
  return (
    process.env.PIKE13_CALLBACK_URL ||
    'http://localhost:5173/api/auth/pike13/callback'
  );
}

function hasCredentials(): boolean {
  return !!(process.env.PIKE13_CLIENT_ID && process.env.PIKE13_CLIENT_SECRET);
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/**
 * Exchanges an authorization code for a Pike 13 access token.
 * Token endpoint: POST https://pike13.com/oauth/token
 *
 * Pike 13 access tokens do not expire, so no refresh logic is needed.
 * Ref: https://developer.pike13.com/docs/authentication
 */
async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(`${getAuthBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(),
      client_id: process.env.PIKE13_CLIENT_ID!,
      client_secret: process.env.PIKE13_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Pike 13 token exchange failed: ${response.status} ${detail}`,
    );
  }

  const data: any = await response.json();
  if (!data.access_token) {
    throw new Error('Pike 13 token response missing access_token');
  }
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Profile fetch
// ---------------------------------------------------------------------------

/**
 * Fetches the authenticated user's Pike 13 profile.
 *
 * Endpoint: GET /api/v2/front/people/me
 * This is the Pike 13 Front API self-service endpoint for the token owner.
 * Ref: https://developer.pike13.com/docs/get_started (front API)
 *
 * Fallback: GET /api/v2/me (older API versions / compatibility)
 *
 * Response shape (either endpoint):
 *   { person: { id, name, email, first_name, last_name } }
 *   or: { people: [{ id, name, email, first_name, last_name }] }
 *
 * Note on email verification: Pike 13 does not explicitly guarantee that
 * emails are verified. Per stakeholder decision 2, Pike 13 emails are
 * treated as verified for the purpose of auto-linking by email. Real
 * deployments should confirm this assumption with Pike 13 before relying
 * on auto-link behavior.
 */
async function fetchPike13Profile(
  accessToken: string,
): Promise<{ id: string; email: string; name: string }> {
  const authBase = getAuthBaseUrl();

  let profileResponse = await fetch(`${authBase}/api/v2/front/people/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!profileResponse.ok) {
    // Fallback to older API version
    profileResponse = await fetch(`${authBase}/api/v2/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
  }

  if (!profileResponse.ok) {
    const body = await profileResponse.text();
    throw new Error(
      `Pike 13 profile fetch failed: ${profileResponse.status} ${body}`,
    );
  }

  const data: any = await profileResponse.json();

  // Response shape: { person: {...} } or { people: [{...}] }
  const person = data?.person ?? data?.people?.[0];
  if (!person) {
    throw new Error(
      `Pike 13 profile response missing person data: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const id = String(person.id ?? '');
  const email = (person.email ?? '').toLowerCase();
  const name =
    person.name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ') ||
    email;

  if (!id || !email) {
    throw new Error(
      `Pike 13 profile missing required fields — id: ${id}, email: ${email}`,
    );
  }

  return { id, email, name };
}

// ---------------------------------------------------------------------------
// OAuth routes
// ---------------------------------------------------------------------------

/**
 * GET /api/auth/pike13
 *
 * Initiates the Pike 13 OAuth 2.0 authorization code flow.
 * Returns 501 if PIKE13_CLIENT_ID or PIKE13_CLIENT_SECRET are not set.
 * Supports ?link=1 to enter link mode (binds the OAuth identity to the
 * currently authenticated user rather than logging in).
 *
 * Authorization endpoint: https://pike13.com/oauth/authorize
 * Ref: https://developer.pike13.com/docs/authentication
 */
pike13Router.get('/auth/pike13', (req: Request, res: Response) => {
  if (!hasCredentials()) {
    return res.status(501).json({
      error: 'Pike 13 OAuth not configured',
      detail: 'Set PIKE13_CLIENT_ID and PIKE13_CLIENT_SECRET',
      docs: PIKE13_AUTH_DOCS,
    });
  }

  if (req.query.link === '1') {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required to link an account' });
    }
    (req.session as any).oauthLinkMode = true;
  }

  const params = new URLSearchParams({
    client_id: process.env.PIKE13_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: callbackUrl(),
  });

  res.redirect(`${getAuthBaseUrl()}/oauth/authorize?${params}`);
});

/**
 * GET /api/auth/pike13/callback
 *
 * Handles the Pike 13 OAuth callback:
 * 1. Exchanges the authorization code for an access token.
 * 2. Fetches the authenticated user's profile (email, name).
 * 3. Calls findOrCreateOAuthUser with provider='pike13'.
 * 4. Stores the access token in req.session.pike13AccessToken.
 * 5. Establishes a Passport session.
 * 6. Redirects to /account (link mode) or / (login mode).
 */
pike13Router.get(
  '/auth/pike13/callback',
  async (req: Request, res: Response) => {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect('/login');
    }

    if (!hasCredentials()) {
      return res
        .status(501)
        .json({ error: 'Pike 13 OAuth not configured', docs: PIKE13_AUTH_DOCS });
    }

    const session = req.session as any;
    const isLinkMode = !!session.oauthLinkMode;

    try {
      const accessToken = await exchangeCodeForToken(code);
      session.pike13AccessToken = accessToken;

      const profile = await fetchPike13Profile(accessToken);

      const user = await findOrCreateOAuthUser(
        req,
        'pike13',
        profile.id,
        profile.email,
        profile.name,
      );

      req.login(user, (err) => {
        if (err) {
          console.error('Pike 13 OAuth login error', err);
          return res.redirect('/login');
        }
        // oauthLinkMode is cleared by findOrCreateOAuthUser; capture before auth
        res.redirect(isLinkMode ? '/account' : '/');
      });
    } catch (err) {
      console.error('Pike 13 OAuth callback error', err);
      res.redirect('/login');
    }
  },
);
