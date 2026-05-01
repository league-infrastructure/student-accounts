---
id: '001'
title: Schema OAuthAuthorizationCode OAuthRefreshToken OAuthConsent
status: done
use-cases:
- SUC-019-001
- SUC-019-003
depends-on: []
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Schema OAuthAuthorizationCode OAuthRefreshToken OAuthConsent

## Description

Add three new Prisma models to `prisma/schema.prisma` per
`architecture-update.md` § "Schema (Prisma)". All three reuse the
existing `OAuthClient` from sprint 018 — this sprint is purely
additive. SQLite is the dev backend, so `string[]` fields are stored as
`Json` columns (mirror the pattern already used for
`OAuthClient.allowed_scopes` and `OAuthClient.redirect_uris`).

Models:

- **`OAuthAuthorizationCode`** — short-lived (10 min) one-time-use code.
  Fields: `id`, `code_hash` (String, unique, SHA-256), `oauth_client_id`
  (FK to `OAuthClient`, `onDelete: Cascade`), `user_id` (FK to `User`,
  `onDelete: Cascade`), `redirect_uri` String, `scopes` Json,
  `code_challenge` String, `code_challenge_method` String (must be
  `"S256"`), `expires_at` DateTime, `consumed_at` DateTime?,
  `created_at` DateTime @default(now()). Index on `oauth_client_id`.
- **`OAuthRefreshToken`** — long-lived (30 day) rotation chain.
  Fields: `id`, `token_hash` (String, unique, SHA-256),
  `oauth_client_id` FK (cascade), `user_id` FK (cascade), `scopes` Json,
  `expires_at` DateTime, `revoked_at` DateTime?, `replaced_by_id` Int?
  (self-FK to `OAuthRefreshToken.id`), `created_at`, `last_used_at`
  DateTime?. Index on `oauth_client_id`. The self-FK is the chain
  pointer used by reuse-detection in ticket 004.
- **`OAuthConsent`** — record that user X granted scopes Y to client Z.
  Fields: `id`, `user_id` FK (cascade), `oauth_client_id` FK (cascade),
  `scopes` Json, `granted_at` DateTime @default(now()). `@@unique([user_id, oauth_client_id])`
  — re-consent UPSERTS over the row (we do not maintain history this
  sprint).

Push the schema with
`npx prisma db push --accept-data-loss --schema=prisma/schema.prisma`
against dev SQLite, then `npx prisma generate` so the generated client
includes the new types. No data backfill — these tables start empty.

## Acceptance Criteria

- [x] `prisma/schema.prisma` has the three new models with the fields and indexes above.
- [x] `OAuthClient` gains the back-relations (`authorization_codes`, `refresh_tokens`, `consents`) so cascade deletes compile.
- [x] `User` gains the back-relations (`oauth_authorization_codes`, `oauth_refresh_tokens`, `oauth_consents`).
- [x] `prisma db push --accept-data-loss` runs cleanly against dev DB.
- [x] `prisma generate` runs cleanly; generated client exposes the new model types.
- [x] `npm run test:server` still green (no new tests this ticket — schema-only).

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: None (schema-only ticket; behavior is exercised in tickets 003, 004, 005, 006, 007).
- **Verification command**: `npm run test:server`
