/**
 * fleetRouter — machine endpoints for the League laptops (sprint 002 T007).
 *
 * Mounted at /api/fleet, public (no session, no cookie). The PAM hook on a
 * laptop runs `league-helper login <user>` with the student's password at
 * every login and calls:
 *
 *   POST /api/fleet/llm-token          {username, password}
 *   POST /api/fleet/llm-token/rotate   {username, password}
 *
 * Both return the student's LLM proxy token (the same `llmp_` token shown on
 * their Account page) plus usage and the base URLs the laptop exports into
 * the session. The token is auto-granted when the student has none, so a
 * laptop student never needs an admin click; `rotate` revokes the active
 * token first so the laptop's "Replace key" gets a fresh one.
 *
 * Credential verification mirrors `routes/auth/login.ts` — lookup by
 * username or primary email, `verifyPassword` (scrypt or `$6$` crypt),
 * active user of any role (students, staff and admins all use the laptops
 * and all get a key; admins are auto-granted) — but WITHOUT the group/cohort
 * passphrase fallback: a shared classroom phrase must not mint a personal
 * API key. Every credential
 * failure returns the same generic 401 body as login so usernames cannot be
 * enumerated. Five failures per username or per client IP inside fifteen
 * minutes block further attempts with 429 (see middleware/attemptLimiter).
 * The password is never logged.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { prisma } from '../services/prisma.js';
import { getConfig } from '../services/config.js';
import { verifyPassword } from '../utils/password.js';
import { createLogger } from '../services/logger.js';
import { fleetAttemptLimiter } from '../middleware/attemptLimiter.js';
import type { BudgetSummary } from '../services/llm-proxy-token.service.js';
import type { LlmProxyToken, User } from '../generated/prisma/client.js';

const logger = createLogger('fleet');

export const fleetRouter = Router();

/** Same body as POST /api/auth/login — callers cannot tell the failures apart. */
const GENERIC_401 = { error: 'Invalid username or password' };
const TOO_MANY_429 = { error: 'too many attempts' };
const NOT_ENABLED_403 = { error: 'llm proxy not enabled' };

/** Model tiers the laptop writes into the seeded tool configs. */
export const FLEET_MODELS = ['league-small', 'league-medium', 'league-large'] as const;
export const FLEET_DEFAULT_MODEL = 'league-medium';

// ---------------------------------------------------------------------------
// Credential check (shared by both endpoints)
// ---------------------------------------------------------------------------

/**
 * Verify the request body's credentials. Writes the 429/401 response itself
 * and returns null on any failure; returns the active user on success.
 */
async function authenticate(req: Request, res: Response): Promise<User | null> {
  const { username: rawUsername, password } = req.body ?? {};
  const identifier = typeof rawUsername === 'string' ? rawUsername.trim() : '';
  const identifierLower = identifier.toLowerCase();

  // One key per client and one per claimed username. The username key is
  // only tracked when a username was actually supplied.
  const ipKey = `ip:${req.ip ?? 'unknown'}`;
  const userKey = identifierLower ? `user:${identifierLower}` : null;
  const keys = userKey ? [ipKey, userKey] : [ipKey];

  if (keys.some((k) => fleetAttemptLimiter.isBlocked(k))) {
    res.status(429).json(TOO_MANY_429);
    return null;
  }

  const fail = (): null => {
    for (const k of keys) fleetAttemptLimiter.recordFailure(k);
    res.status(401).json(GENERIC_401);
    return null;
  };

  if (!identifier || typeof password !== 'string' || !password) return fail();

  // Lookup exactly like login: username (stored lowercase), then primary
  // email as typed and lowercased.
  let user = await prisma.user.findUnique({ where: { username: identifierLower } });
  if (user == null) {
    user =
      (await prisma.user.findUnique({ where: { primary_email: identifier } })) ??
      (await prisma.user.findUnique({ where: { primary_email: identifierLower } }));
  }

  if (user == null || user.is_active === false) return fail();
  if (user.password_hash == null || !(await verifyPassword(password, user.password_hash))) {
    return fail();
  }

  // Correct password below the cap: forgive this username's earlier typos.
  // The IP counter is left alone so interleaving one good login does not
  // reset a scan of other usernames from the same machine.
  if (userKey) fleetAttemptLimiter.clear(userKey);
  return user;
}

/**
 * Whether the user may hold a proxy token. Either an admin (or a signup
 * passphrase) already turned the flag on, or the user is a laptop account —
 * username plus laptop password hash — which is auto-granted. Admins
 * themselves always may: they are the people testing the laptops.
 */
function mayHoldToken(user: User): boolean {
  if (user.allows_llm_proxy || user.role === 'admin') return true;
  return user.username != null && user.laptop_password_hash != null;
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/** Scheme and host as the client reached us — same derivation as GET /api/account. */
function requestOrigin(req: Request): string {
  const forwardedProto = req.header('x-forwarded-proto');
  const scheme = forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : req.secure
      ? 'https'
      : 'http';
  const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  return `${scheme}://${host}`;
}

/**
 * Response body. snake_case to match the laptop's existing keys; the dollar
 * fields (sprint 003) mirror `budgetUsd` / `spentUsd` / `spentUsdTotal` /
 * `periodResetsAt` on GET /api/account/llm-proxy.
 */
function tokenResponse(req: Request, user: User, apiKey: string, row: LlmProxyToken, budget: BudgetSummary) {
  const origin = requestOrigin(req);
  const anthropicEnabled = getConfig('LLM_PROXY_ANTHROPIC_ENABLED') === 'true';
  return {
    user_id: user.id,
    username: user.username,
    api_key: apiKey,
    base_url: `${origin}/proxy/v1`,
    ...(anthropicEnabled ? { anthropic_base_url: `${origin}/proxy` } : {}),
    models: [...FLEET_MODELS],
    default_model: FLEET_DEFAULT_MODEL,
    token_limit: row.token_limit,
    tokens_used: row.tokens_used,
    request_count: row.request_count,
    budget_usd: budget.budgetUsd,
    spent_usd: budget.spentUsd,
    spent_usd_total: budget.spentUsdTotal,
    period_resets_at: budget.periodResetsAt,
    expires_at: row.expires_at.toISOString(),
    granted_at: row.granted_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * One handler for both endpoints: authenticate, check eligibility, make sure
 * an active token exists (revoking the current one first when rotating),
 * audit, respond.
 */
function issueToken(rotate: boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await authenticate(req, res);
      if (user == null) return;

      if (!mayHoldToken(user)) {
        return res.status(403).json(NOT_ENABLED_403);
      }

      const { llmProxyTokens, audit } = req.services;

      if (rotate && (await llmProxyTokens.getActiveForUser(user.id)) != null) {
        await llmProxyTokens.revoke(user.id, user.id);
      }
      const { row, token } = await llmProxyTokens.ensureActive(user.id, user.id, 'fleet');

      // The laptop sends its hostname so the admin can see which machine
      // fetched the token. Awaited (not fire-and-forget) so the row is there
      // by the time the laptop has its key; a failure is logged, not fatal.
      try {
        await audit.record(prisma, {
          actor_user_id: user.id,
          action: rotate ? 'fleet_llm_token_rotated' : 'fleet_llm_token_issued',
          target_user_id: user.id,
          target_entity_type: 'LlmProxyToken',
          target_entity_id: String(row.id),
          details: { host: req.get('X-League-Host') ?? null },
        });
      } catch (err) {
        logger.error({ err, userId: user.id }, '[fleet] failed to write audit event');
      }

      return res.json(tokenResponse(req, user, token, row, llmProxyTokens.budgetSummary(row)));
    } catch (err) {
      return next(err);
    }
  };
}

fleetRouter.post('/llm-token', issueToken(false));
fleetRouter.post('/llm-token/rotate', issueToken(true));
