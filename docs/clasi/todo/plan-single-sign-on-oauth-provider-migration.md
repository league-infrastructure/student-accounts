---
status: pending
---

# Plan: Single Sign-On / OAuth Provider Migration

## Context

Today `student-accounts` is a student-account-management app: Google/GitHub/Pike13/passphrase/password login flows, an `/account` page for students, an admin panel for staff, and an LLM proxy that forwards Claude API calls per-student. Staff have no personal account screen — they go straight to admin.

We want this app to become **the League's identity service**: every user (student, staff, admin) lands on a personal account dashboard that links out to whatever sub-applications they're entitled to. The current admin-only "user management" becomes one such sub-app. The LLM proxy becomes a tile for students. Eventually other apps (relay services, custom tools) plug in here.

To make that real, this app must also become an **OAuth provider** — third-party apps register as clients (client_id + secret + redirect URIs), and they authenticate end-users via this service. To prove the provider works end-to-end, we ship a small read-only directory API (`GET /v1/users`, `GET /v1/users/:id`) that an external client can call after exchanging credentials for a token.

This plan breaks the work into **four sequenced sprints**. Each is shippable on its own and unblocks the next.

---

## Existing infrastructure we reuse

(All paths under `/Users/eric/proj/league/infrastructure/student-accounts/`)

- **Prisma schema** — [server/prisma/schema.prisma](server/prisma/schema.prisma). Existing models: `User`, `Login`, `ExternalAccount`, `LlmProxyToken`, `Session`, `AuditEvent`, `Cohort`, `Group`, `ProvisioningRequest`.
- **Passport strategies** — [server/src/services/auth/passport.config.ts](server/src/services/auth/passport.config.ts), [server/src/routes/auth.ts](server/src/routes/auth.ts). Pluggable; new providers/flows mount the same way.
- **Token-hash pattern** — [server/src/services/llm-proxy/](server/src/services/llm-proxy/) already does opaque bearer tokens with SHA-256 hashing, expiry, quotas. Copy this pattern for OAuth access/refresh tokens; do not invent a new scheme.
- **Google Directory client** — [server/src/services/google-workspace/google-workspace-admin.client.ts](server/src/services/google-workspace/google-workspace-admin.client.ts) already does domain-wide-delegation lookups. Extend it (don't replace) to fetch groups + OU at login.
- **Audit trail** — `AuditEvent` model is already wired for actor/action/target. Reuse for OAuth grant/revoke/auth-code/token events.
- **Account page** — [client/src/pages/Account.tsx](client/src/pages/Account.tsx). Today student-only; in Sprint 1 it becomes the universal landing page.
- **Admin panel** — [client/src/pages/admin/](client/src/pages/admin/) and `/api/admin/*` routes. Move user-management routes under this in Sprint 1.

---

## Sprint 1 — Universal Account Dashboard + App Tiles

**Goal:** Every authenticated user lands on `/account`. The page renders role-appropriate "app tiles" linking to sub-apps. User Management becomes a tile (staff/admin only). LLM proxy becomes a tile (students with grant). No new identity logic.

### Server
- New endpoint `GET /api/account/apps` — returns the tile list for the current user, computed server-side from role + entitlements (LLM token granted? staff? admin?). Tile shape: `{ id, title, description, href, icon }`.
- Post-login redirect: regardless of role, send to `/account`. Update [server/src/routes/auth.ts](server/src/routes/auth.ts) callbacks; remove the staff→`/staff/directory` and admin→`/` special cases.

### Client
- Refactor [client/src/pages/Account.tsx](client/src/pages/Account.tsx) into two zones: **Profile/Identity** (existing content — linked logins, approval status, profile edit) and **Apps** (new tile grid populated from `/api/account/apps`).
- New `AppTile` component.
- Move admin user-management UI under `/admin/users` (it largely is already); make the entry point a tile, not a default route.
- `/staff/directory` becomes a tile, not a default landing.

### Migration / data
- None. Pure routing + UI.

### Out of scope
- No schema changes. No new auth methods. No OAuth provider work.

---

## Sprint 2 — Login Provenance Capture + Google Directory Enrichment

**Goal:** Persist the raw provider payload from every login so we can mine it later (groups, teams, claims). For Google specifically, also fetch directory metadata (groups + OU) at login time and store it.

### Schema changes — [server/prisma/schema.prisma](server/prisma/schema.prisma)
- Add `provider_payload Json?` to `Login` (most recent raw profile from the provider).
- Add `provider_payload_updated_at DateTime?` to `Login`.
- Add `directory_metadata Json?` to `Login` (Google-specific today: `{ ou_path, groups: [...] }`; nullable for other providers).
- Optional: new `LoginEvent` table `(id, login_id, occurred_at, payload Json, ip, user_agent)` if we want per-event history rather than just last-known. **Recommendation:** ship `LoginEvent` from the start — it's cheap and avoids a future migration.

### Server
- In [server/src/services/auth/sign-in.handler.ts](server/src/services/auth/sign-in.handler.ts), after a Login is upserted: write the raw profile to `Login.provider_payload` and append a `LoginEvent`.
- Extend `GoogleWorkspaceAdminClientImpl` with `listUserGroups(email)` (Directory API `groups.list?userKey=`) and `getUserOrgUnit(email)` (already partially there).
- For Google sign-ins of `@jointheleague.org` users, call both at login, populate `Login.directory_metadata`. Fail-soft: log + continue if the directory call fails (don't block login).
- Typed accessor module `server/src/services/auth/login-payload.ts` exposing `getGoogleGroups(login)`, `getGoogleOu(login)`, `getGitHubLogin(login)`, etc. Keep storage as `Json` but read through typed helpers.

### Client
- No required UI changes. Optional: surface "Last login: …" or "Groups: …" on the Account page if useful for verification.

### Out of scope
- GitHub teams, Pike13 enrichment — defer until we have a use case. Schema accommodates them.

---

## Sprint 3 — OAuth Application Registry + Client-Credentials API

**Goal:** Admin can register "OAuth Applications" (client_id + secret + redirect URIs). External clients exchange credentials for a token and call a small read-only directory API. Proves the token plumbing before we wire up the user-facing OAuth flow.

### Schema changes
- New `OAuthClient` model: `id, client_id (unique), client_secret_hash, name, description, redirect_uris (String[]), allowed_scopes (String[]), created_by (User), created_at, disabled_at`.
- New `OAuthAccessToken` model: `id, client_id (FK), user_id (FK, nullable for client-credentials), token_hash, scopes (String[]), expires_at, revoked_at, created_at, last_used_at`. Mirror [server/prisma/schema.prisma](server/prisma/schema.prisma)'s `LlmProxyToken` shape closely.

### Server
- New routes module `server/src/routes/oauth.ts`:
  - `POST /oauth/token` — `grant_type=client_credentials` (the only grant this sprint). Validates client_id + secret (constant-time compare on hash), issues opaque access token, hashes + stores.
  - Bearer-auth middleware `oauthBearer` that validates against `OAuthAccessToken`.
- New routes module `server/src/routes/v1-directory.ts` (mounted at `/v1`, behind `oauthBearer` with required scope `users:read`):
  - `GET /v1/users` — paginated list. Minimal fields: `{ id, display_name, primary_email, role, is_active }`.
  - `GET /v1/users/:id` — single record, slightly more detail.
- Admin routes `POST/GET/PATCH/DELETE /api/admin/oauth-clients` for CRUD. Secret shown **once** on creation/rotation, then only its hash is stored — reuse the `LlmProxyToken` "show plaintext once" UX pattern.
- Audit-log every client creation, secret rotation, token issuance, and `/v1` call.

### Client
- New admin page `/admin/oauth-clients` under the User Management sub-app. List, create, rotate-secret, disable. After create/rotate, display the secret in a "copy now, you won't see it again" modal.

### Verification
- Create a client in admin UI → `curl -u client_id:secret -d grant_type=client_credentials https://.../oauth/token` → use returned token to `curl -H "Authorization: Bearer …" .../v1/users`. End-to-end works.

### Out of scope
- User authorization flow (Sprint 4). No `/oauth/authorize`, no consent screen, no refresh tokens yet.

---

## Sprint 4 — OAuth Authorization-Code Provider Flow

**Goal:** External apps log users in via this service. Standard OAuth 2.0 authorization-code flow with PKCE. Localhost redirects accepted on any port.

### Schema changes
- Add `OAuthAuthorizationCode` model: `id, code_hash, client_id, user_id, redirect_uri, scopes, code_challenge, code_challenge_method, expires_at (short — 10 min), consumed_at`.
- Add `OAuthRefreshToken` model: `id, token_hash, client_id, user_id, scopes, expires_at, revoked_at, replaced_by_id`.
- Optional: `OAuthConsent` model `(user_id, client_id, scopes, granted_at)` so we don't re-prompt on every login.

### Server — extend `server/src/routes/oauth.ts`
- `GET /oauth/authorize` — query params per RFC 6749. If user not logged in → redirect to `/login?next=/oauth/authorize?…`. If logged in and consent already on file → mint code, redirect. Otherwise render consent screen.
- `POST /oauth/authorize/consent` — record consent, mint code, redirect.
- `POST /oauth/token` — extend to handle `grant_type=authorization_code` (with PKCE verifier check) and `grant_type=refresh_token`. Code is single-use (reject if `consumed_at` set).
- `GET /oauth/userinfo` — bearer-authed; returns `{ sub, email, name, role, groups? }`. OIDC-shaped subset; we don't need to be a full OIDC provider yet.
- **Redirect-URI matching rule:** exact match against `OAuthClient.redirect_uris` *OR* host is `localhost`/`127.0.0.1` on any port and path matches a registered localhost entry's path. Centralize this in `server/src/services/oauth/redirect-matcher.ts` — easy to unit-test, easy to tighten later.

### Client
- New consent page `client/src/pages/OAuthConsent.tsx`: shows requesting app name, requested scopes, Allow/Deny buttons.
- Admin page from Sprint 3 gains `redirect_uris` editor.

### Verification
- Spin up a tiny test client (a local script or a stub page on `localhost:9999`) → kick off auth-code flow → consent → callback receives code → exchange for token → `GET /oauth/userinfo` returns the user. Document this flow in `docs/oauth-provider.md` for future integrators.

### Out of scope
- Full OIDC compliance (id_tokens, JWKS, discovery doc). Add later if/when an integration requires it.
- Dynamic client registration.
- Per-user revocation UI (defer; admin-level disable is enough for v1).

---

## Cross-cutting concerns

- **Spec/use-case docs:** Sprint 1 should also update [docs/clasi/design/specification.md](docs/clasi/design/specification.md) to reflect that this service is no longer student-only; current spec explicitly says "no OAuth stored" — we're changing that. Add new use cases UC-019+: "User views personal dashboard", "Admin registers OAuth client", "External app authenticates user via SSO".
- **Architecture updates:** Each sprint produces an `architecture-update-NNN.md` per CLASI process. Consolidate after Sprint 4.
- **Security:** All client secrets, auth codes, access tokens, refresh tokens stored as hashes only. Plaintext shown once on creation/rotation. Rate-limit `/oauth/token` and `/v1/*` (reuse whatever rate-limit exists for `/proxy/v1`; if none, add basic per-client buckets in Sprint 3).
- **Testing:** Each sprint adds integration tests against a real test DB (per project's testing rule: no DB mocks). Sprint 4's redirect-matcher gets unit tests covering localhost-any-port behavior explicitly.

---

## Critical files to touch (cheat-sheet)

- Schema: [server/prisma/schema.prisma](server/prisma/schema.prisma)
- Auth callbacks: [server/src/routes/auth.ts](server/src/routes/auth.ts)
- Sign-in handler: [server/src/services/auth/sign-in.handler.ts](server/src/services/auth/sign-in.handler.ts)
- Passport config: [server/src/services/auth/passport.config.ts](server/src/services/auth/passport.config.ts)
- Google admin client: [server/src/services/google-workspace/google-workspace-admin.client.ts](server/src/services/google-workspace/google-workspace-admin.client.ts)
- App routing: [server/src/app.ts](server/src/app.ts)
- Account page: [client/src/pages/Account.tsx](client/src/pages/Account.tsx)
- Client routes: [client/src/App.tsx](client/src/App.tsx)
- New: `server/src/routes/oauth.ts`, `server/src/routes/v1-directory.ts`, `server/src/services/oauth/`
- New: `client/src/pages/OAuthConsent.tsx`, admin OAuth-clients page

---

## Sequencing rationale

1. **Dashboard first** — cheap, unblocks everyone seeing the new shape; no schema risk.
2. **Login provenance second** — small schema add, no API surface; later sprints rely on this data.
3. **Client-credentials API third** — proves OAuth token plumbing on the simpler grant first; gives us the directory API as a real consumer of OAuth tokens.
4. **Authorization-code last** — biggest, most security-sensitive; benefits from the registry/token infra already shipped and exercised.
