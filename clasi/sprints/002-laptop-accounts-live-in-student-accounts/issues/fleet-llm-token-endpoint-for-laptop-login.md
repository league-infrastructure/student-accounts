---
status: in-progress
sprint: '002'
tickets:
- 002-007
---

# Laptop login fetches the student's LLM proxy token: a machine endpoint

## Context

Laptop students should use **the same LLM proxy and token** as everyone
else (`/proxy/v1`, `llmp_` bearer token, League model tiers). The laptops
already have the moment and the credential to fetch it: the PAM hook runs
`league-helper login <id>` with the student's password at every login
(`ubuntu-install`, `machine-config/files/league-helper`). Fleet-side code
to call an endpoint, write `~/.local/state/league/llm.env`, export
`OPENAI_BASE_URL`/`OPENAI_API_KEY` into the session and seed
OpenCode/Hermes/Continue configs already exists on a branch of
`ubuntu-install` and only needs this endpoint's URL and response shape.

There is no machine-usable login here today: `POST /api/auth/login` sets a
session cookie and returns a profile, and the OAuth server has no password
or device grant.

## Scope

- `POST /api/fleet/llm-token` `{username, password}` → the user's active
  proxy token and usage, JSON only, no cookie.
- Auto-grant for laptop students so the first login gets a token.
- Throttling and audit.

## Design

**Endpoint** (`server/src/routes/fleet.ts`, mounted at `/api/fleet`,
public like `/api/auth/login`):

Request `{"username": "alice", "password": "..."}`.
Verification identical to `routes/auth/login.ts` (scrypt or `$6$` via
`verifyPassword`; passphrase **not** accepted here). Requires
`is_active`, `role` student or staff, `allows_llm_proxy` (see below).

Response 200:

```json
{"user_id": 42, "username": "alice",
 "api_key": "llmp_...", "base_url": "https://student-accounts.jtlapp.net/proxy/v1",
 "anthropic_base_url": "https://student-accounts.jtlapp.net/proxy",
 "models": ["league-small", "league-medium", "league-large"], "default_model": "league-medium",
 "token_limit": 1000000, "tokens_used": 1234, "request_count": 7,
 "expires_at": "...", "granted_at": "..."}
```

`base_url` is derived from the request host like `GET /api/account` does
for `endpoint`. 401 generic for any credential failure (same
`GENERIC_401` body as login), 403 `{error: "llm proxy not enabled"}` when
the user may not have a token, 429 after 5 failures per username or
client IP in 15 minutes (in-memory map; the app runs one replica). Audit
`fleet_llm_token_issued` with `created_host` taken from an optional
`X-League-Host` header the laptop sends (its hostname), so the admin can
see which machine fetched it. Never log the password.

**Rotate.** `POST /api/fleet/llm-token/rotate`, same body: revoke the
active token and grant a new one with the same limit and expiry. Used by
the laptop app's "Replace key".

**Auto-grant.** Laptop students must not need an admin click to get a
token. Rule: a student with `allows_laptop_account` and username+password
(including everyone the one-time import created, `created_via =
laptop_import`) is `allows_llm_proxy = true` by default;
`reconcileAccessFlags()` at startup then mints tokens (`grant(userId, {expiresAt: +1y, tokenLimit: LLM_PROXY_DEFAULT_TOKEN_LIMIT})`).
The endpoint itself calls `getActiveForUser`, and if none exists but the
flag is on, grants one inline (scope `fleet`). Expired token → grant a new
one inline the same way, so a returning student never sees 403 for
expiry. Admins can still revoke and clear the flag.

**Tiers for the laptops.** `default_model: league-medium` is what the
laptop writes into the seeded tool configs; the laptops export
`OPENAI_BASE_URL=<base_url>` and `OPENAI_API_KEY=<api_key>`, and, when
the response carries `anthropic_base_url` (set once the Anthropic
endpoint issue ships), `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` too.

## Files

- `server/src/routes/fleet.ts` (new), `server/src/app.ts` (mount),
  `server/src/middleware/rateLimit.ts` (new, small)
- `server/src/services/llm-proxy-token.service.ts`: `ensureActive(userId,
  actorId, scope)` helper (grant-if-missing/expired) used by the endpoint
  and by the importer
- `server/src/routes/admin/users.ts` / user creation paths: default
  `allows_llm_proxy` for laptop students
- Tests: `tests/server/routes/fleet.test.ts` (supertest): 200 shape, same
  token on second call, 401 wrong password, 429 after 5, 403 when flag
  off, rotate changes token and old one is rejected by
  `llmProxyTokenAuth`, `$6$` password accepted.

## Verification

1. Route tests above green.
2. Manual: `curl -X POST .../api/fleet/llm-token -d '{"username":"alice","password":"..."}'`
   → token; `curl .../proxy/v1/chat/completions -H "Authorization: Bearer
   <token>" -d '{"model":"league-small",...}'` → 200 and `tokens_used`
   increments.
3. On a laptop with the `ubuntu-install` branch pointed at this URL: log
   in as `alice`, open a terminal, `echo $OPENAI_BASE_URL`, run `opencode`
   and get a completion; the Student Account app's AI key tab shows usage.

## Dependencies

- Import issue for `$6$` verification (imported accounts) and the
  management issue for `allows_laptop_account`. The endpoint itself can
  land first for users who already have scrypt passwords.
- Fleet side: `ubuntu-install` issue
  `docs/issue-laptop-accounts-move-to-student-accounts.md` (set
  `LLM_BROKER_URL` to this app, match the response fields).
