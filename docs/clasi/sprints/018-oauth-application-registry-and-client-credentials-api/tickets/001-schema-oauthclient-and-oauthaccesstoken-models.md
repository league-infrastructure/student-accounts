---
id: "001"
title: "Schema OAuthClient and OAuthAccessToken models"
status: todo
use-cases: [SUC-018-001, SUC-018-002]
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Schema OAuthClient and OAuthAccessToken models

## Description

Add the two new Prisma models that back the OAuth provider work for this
sprint: `OAuthClient` (registry of third-party applications) and
`OAuthAccessToken` (opaque bearer tokens minted by `/oauth/token`). Both
models are described in `architecture-update.md` under "Schema (Prisma)";
follow the field list there exactly — including cascade rules
(`SetNull` on `OAuthClient.created_by` when the User is deleted, cascade
delete `OAuthAccessToken` with its `OAuthClient`).

This is the data foundation for both SUC-018-001 (admin registers a
client) and SUC-018-002 (external service mints a token), so it must
land before any service-layer work.

SQLite gotcha: Prisma's native `String[]` type only works on Postgres.
For dev SQLite we store `redirect_uris` and `allowed_scopes` (and the
token's `scopes`) as `Json` columns and serialize/deserialize string
arrays in the service layer. The architecture doc calls this out — keep
it consistent across both models so the service helpers are reusable.

After editing the schema, run `prisma db push --accept-data-loss
--schema=prisma/schema.prisma` against the dev DB and `prisma generate`
so the client types are available to ticket 002.

## Acceptance Criteria

- [ ] `prisma/schema.prisma` contains `OAuthClient` and `OAuthAccessToken` models matching the field list in `architecture-update.md`.
- [ ] String-array fields are typed as `Json` (SQLite-compatible) with a clear comment.
- [ ] `OAuthClient.client_id` is unique-indexed.
- [ ] `OAuthAccessToken.token_hash` is unique-indexed.
- [ ] FK relations: `OAuthClient.created_by → User` (SetNull); `OAuthAccessToken.oauth_client_id → OAuthClient` (Cascade); `OAuthAccessToken.user_id → User` (nullable, SetNull).
- [ ] `prisma db push` succeeds against the dev DB with no data loss on existing tables.
- [ ] `prisma generate` produces TypeScript types that downstream tickets can import.
- [ ] Existing `npm run test:server` suite still passes (no behavioral changes yet).

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: No new tests this ticket — schema-only. Subsequent tickets exercise the models. Optional smoke: a small Prisma assertion that creating an `OAuthClient` and reading it back round-trips the JSON arrays correctly (can live in the service test file added in ticket 002).
- **Verification command**: `npm run test:server`
