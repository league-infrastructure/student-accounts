---
id: 019
title: OAuth Authorization-Code Provider Flow
status: done
branch: sprint/019-oauth-authorization-code-provider-flow
use-cases:
- SUC-019-001
- SUC-019-002
- SUC-019-003
- SUC-019-004
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 019: OAuth Authorization-Code Provider Flow

## Goals

External applications log in users via this service. Standard OAuth 2.0
authorization-code flow with PKCE (RFC 7636). Refresh tokens supported.
Localhost redirect URIs accepted on any port. A consent screen lets users
grant or deny scope access; consent is remembered to avoid re-prompting.

This is the headline sprint of the migration: after it, third-party
services can use this app as their identity provider.

## Problem

Sprint 018 shipped the simpler client-credentials grant — service-to-service
tokens. Sprint 019 adds the user-facing flow:

- Third-party apps need a way to authenticate end-users via this service
  rather than running their own login.
- The flow must be standard OAuth 2.0 + PKCE so any compliant client
  library works.
- Localhost development is common (CLI tools, dev scripts) — redirects to
  `http://localhost:<any-port>/callback` must be allowed without
  pre-registering every port.

## Solution

1. **Schema:**
   - `OAuthAuthorizationCode`: short-lived (10 min) one-time use code linking
     a user + client + scopes + PKCE challenge.
   - `OAuthRefreshToken`: long-lived rotation chain (`replaced_by_id`).
     Hashed like access tokens.
   - `OAuthConsent`: records that user X has granted scopes Y to client Z;
     used to skip the consent screen on subsequent authorizations.

2. **`/oauth/authorize` (GET):**
   - Validates `client_id`, `redirect_uri`, `response_type=code`,
     `code_challenge`, `code_challenge_method=S256`, `scope`, `state`.
   - If user not signed in → redirect to `/login?next=<encoded-authorize-url>`.
   - If user signed in and consent on file for the requested scopes → mint
     code, redirect to `redirect_uri?code=...&state=...`.
   - Otherwise render consent screen (`/oauth/consent`).

3. **`/oauth/authorize/consent` (POST):**
   - Body: `client_id`, `redirect_uri`, `scopes`, `state`, `code_challenge`,
     `code_challenge_method`, `decision: 'allow' | 'deny'`.
   - On `allow`: record `OAuthConsent`, mint `OAuthAuthorizationCode`, redirect
     to `redirect_uri?code=...&state=...`.
   - On `deny`: redirect to `redirect_uri?error=access_denied&state=...`.

4. **`/oauth/token` (POST) — extend:**
   - `grant_type=authorization_code`: validate code (single-use, expiry,
     PKCE verifier check via SHA-256), mint access token + refresh token,
     mark code consumed.
   - `grant_type=refresh_token`: validate refresh token, mint new access
     token + (rotated) refresh token. Original refresh token marked replaced.
   - `grant_type=client_credentials`: unchanged from sprint 018.

5. **`/oauth/userinfo` (GET):** bearer-authed. Returns
   `{ sub: id, email, name: display_name, role, groups? }`. OIDC-shaped
   subset (`sub` is the user id as a string). Required scope: `openid` or
   `profile` (we'll use `profile` for simplicity; document it).

6. **Redirect-URI matcher** (`server/src/services/oauth/redirect-matcher.ts`):
   - Pure function: `matches(registered: string[], candidate: string)`.
   - Match rule: exact match against any entry in `registered`, OR the
     candidate's host is `localhost` or `127.0.0.1` and a registered entry
     has the same path with host `localhost`/`127.0.0.1` (any port allowed).
   - Centralized so the rule is testable in isolation; both authorize and
     consent endpoints use it.

7. **Consent page** (`client/src/pages/OAuthConsent.tsx`):
   - Shown when `/oauth/authorize` decides consent is needed.
   - Displays the requesting client's `name` + `description`, the requested
     scopes (with human-readable labels), and Allow/Deny buttons.
   - Submit → POST `/oauth/authorize/consent`.

8. **Admin UI:** the OAuth-Clients admin page from sprint 018 gains an
   editor for `redirect_uris` (already creatable; this sprint adds a
   dedicated multi-line editor with localhost-pattern guidance).

9. **Documentation:** `docs/oauth-provider.md` walks an integrator through
   registering a client, performing the authorization-code+PKCE flow, and
   calling `/oauth/userinfo`. Includes a working `curl` script for a
   localhost test client.

## Success Criteria

- New schema applied via `prisma db push`.
- A registered third-party client (created in admin UI) can:
  1. Send a user to `/oauth/authorize?...&code_challenge=...&code_challenge_method=S256`.
  2. User signs in (if not already), is shown the consent screen (if not previously consented), clicks Allow.
  3. Browser is redirected to the client's `redirect_uri?code=...&state=...`.
  4. Client POSTs to `/oauth/token` with `grant_type=authorization_code`, the code, and the PKCE verifier. Receives access + refresh tokens.
  5. Client GETs `/oauth/userinfo` with the access token. Receives the user's identity.
  6. Client POSTs to `/oauth/token` with `grant_type=refresh_token` to rotate. Old refresh token is marked replaced; new one is valid.
- Consent is remembered: re-running step 1 on the same browser/session for the same `(client, scopes)` skips the consent screen.
- Localhost redirect URIs work on any port even if only `http://localhost:8080/callback` was registered (registered path must match).
- Replay of an already-consumed authorization code returns 400 `invalid_grant`.
- PKCE verifier mismatch returns 400 `invalid_grant`.
- Disabled client cannot mint codes or tokens (401).
- All new tests pass; existing tests unaffected.

## Scope

### In Scope

- `OAuthAuthorizationCode`, `OAuthRefreshToken`, `OAuthConsent` models.
- `GET /oauth/authorize` + `POST /oauth/authorize/consent`.
- `POST /oauth/token` extended with `authorization_code` and `refresh_token` grants.
- `GET /oauth/userinfo`.
- Redirect-URI matcher with localhost-any-port support.
- Consent page UI.
- Refresh-token rotation (single-use).
- `docs/oauth-provider.md`.
- Comprehensive integration tests for the full flow + edge cases.

### Out of Scope

- Full OIDC compliance (`id_token` JWT, JWKS, discovery doc, nonce). Add later if/when an integration requires it.
- Dynamic client registration.
- Per-user revocation UI ("sign out of app X"). Admin-level disable is enough for v1.
- PAR (Pushed Authorization Requests).
- DPoP, mTLS, sender-constrained tokens.

## Test Strategy

Integration tests against the real test DB. Cover:

**Happy path (full flow):**
- Authorize → consent → code → token (with PKCE verifier) → userinfo → refresh.

**Authorize endpoint:**
- Unauthenticated user → 302 to `/login?next=...`.
- Authenticated, no consent → renders consent.
- Authenticated, consent on file → mints code, redirects with `code` + `state`.
- Missing `code_challenge` → 400.
- Unknown `client_id` → 400.
- Disallowed `redirect_uri` → 400.
- Localhost-any-port redirect that matches a registered localhost path → 302 with code.

**Consent endpoint:**
- `decision=deny` → redirect with `error=access_denied`.
- `decision=allow` → record consent, mint code, redirect.

**Token endpoint (`authorization_code`):**
- Valid code + verifier → tokens.
- Already-consumed code → 400 `invalid_grant`.
- Wrong verifier → 400 `invalid_grant`.
- Expired code → 400.
- Wrong `redirect_uri` (mismatched between authorize and token) → 400.

**Token endpoint (`refresh_token`):**
- Valid refresh → rotated tokens.
- Replayed (already-rotated) refresh → 400.
- Refresh from disabled client → 401.

**Userinfo:**
- Valid access token with `profile` scope → 200 with user fields.
- Token without `profile` scope → 403.
- Expired token → 401.

**Redirect matcher unit tests** (its own file):
- Exact match.
- Localhost any-port (`http://localhost:5555/cb` matches registered `http://localhost:8080/cb`).
- Localhost path mismatch → no match.
- Non-localhost different port → no match.
- 127.0.0.1 vs localhost (treat as equivalent or as distinct? — pick one, document).

## Architecture Notes

- **PKCE method:** S256 only. Reject `plain` (deprecated).
- **Code lifetime:** 10 minutes.
- **Access token lifetime:** 1 hour (same as sprint 018 client-credentials).
- **Refresh token lifetime:** 30 days. Rotated on every use.
- **Refresh-token reuse detection:** if a refresh token that has already been replaced is presented, revoke the entire chain (defense in depth — common practice). Logged as a security event.
- **Reusing sprint 018 infra:** `OAuthClient` model and `oauthBearer` middleware are reused; `oauthBearer` is the gate for `/oauth/userinfo`.
- **Consent storage:** one row per `(user, client, scopes)` triple. If the requested scopes are a subset of an existing consent's scopes, that's a hit. Sprint defers more sophisticated per-scope diff'ing.
- **Login redirect:** `/login` page already exists. `/oauth/authorize` will redirect there with `next=` set. After successful login, the existing `/account` redirect is overridden by `next=` if present and points to a same-origin path.
- **Cookies:** Existing express-session cookie is used. No separate OAuth-flow cookie.

## GitHub Issues

(None linked.)

## Definition of Ready

- [x] Sprint planning documents complete.
- [x] Architecture review passed.
- [x] Stakeholder approved.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema OAuthAuthorizationCode OAuthRefreshToken OAuthConsent | — | 1 |
| 002 | redirect-matcher pure module with localhost-any-port unit tests | — | 1 |
| 003 | OAuth code service mint validate consume PKCE | 001 | 2 |
| 004 | OAuth refresh-token service rotation chain | 001 | 2 |
| 005 | GET /oauth/authorize with login-redirect and consent-skip | 001, 002, 003 | 3 |
| 006 | POST /oauth/authorize/consent allow and deny | 003, 005 | 4 |
| 007 | POST /oauth/token authorization-code and refresh-token grants | 003, 004 | 3 |
| 008 | GET /oauth/userinfo | — | 3 |
| 009 | Login page next= param honors same-origin redirects | — | 1 |
| 010 | Consent page client/src/pages/OAuthConsent.tsx | 005, 006 | 5 |
| 011 | docs/oauth-provider.md integrator guide | 005-010 | 6 |
| 012 | Manual smoke pass with localhost test client | 001-011 | 7 |
