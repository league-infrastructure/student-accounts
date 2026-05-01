---
id: '017'
title: Login Provenance and Google Directory Enrichment
status: done
branch: sprint/017-login-provenance-and-google-directory-enrichment
use-cases:
- SUC-017-001
- SUC-017-002
- SUC-017-003
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 017: Login Provenance and Google Directory Enrichment

## Goals

Persist the raw OAuth provider payload from every sign-in so we can mine it
later. For Google `@jointheleague.org` sign-ins, also fetch directory
metadata (groups + OU) at login and store it. Add a `LoginEvent` table for
per-event history.

This sprint is foundation for sprints 018–019. No new public API surface;
everything is internal data plumbing.

## Problem

Today `signInHandler` discards the raw provider profile after extracting a
small set of fields. We have no record of:

- The raw provider profile (groups, teams, claims).
- A history of sign-ins per Login.
- For Google staff, what OU/groups they're in (Sprint 015 looks up OU but
  throws the result away).

Future sprints and admin needs depend on this data. Capture it cheaply now.

## Solution

1. Add four columns to `Login`:
   - `provider_payload Json?`
   - `provider_payload_updated_at DateTime?`
   - `directory_metadata Json?` (Google-specific: `{ ou_path, groups }`)
2. Add `LoginEvent` model: `(id, login_id FK, occurred_at, payload Json, ip String?, user_agent String?)`. Cascade-delete with the `Login` row.
3. In `signInHandler`, after upsert: write `provider_payload`, bump `provider_payload_updated_at`, append a `LoginEvent`. The IP and user agent come through a new optional `requestContext` argument.
4. Extend `GoogleWorkspaceAdminClientImpl` with `listUserGroups(email)`. The existing `getUserOU` stays.
5. For `@jointheleague.org` Google sign-ins, after the existing Step 4 OU check completes, also call `listUserGroups`, combine with the OU result, and store as `Login.directory_metadata`. Fail-soft on either Google call (log + continue; do not block sign-in).
6. New typed accessor module `server/src/services/auth/login-payload.ts`: `getGoogleGroups(login)`, `getGoogleOu(login)`, `getGitHubLogin(login)`, etc. Storage stays Json; consumers read through typed helpers.

## Success Criteria

- Schema migration applied via `prisma db push`.
- After a Google sign-in, the user's `Login` row has `provider_payload`, `provider_payload_updated_at`, and (for `@jointheleague.org`) `directory_metadata` set.
- After GitHub or Pike13 sign-in, `Login` has `provider_payload`; `directory_metadata` stays null.
- A `LoginEvent` row is written for every sign-in.
- `login-payload.ts` typed helpers exist and are used in production code where directory metadata is consumed.
- Sign-in proceeds even when `listUserGroups` throws.
- All existing sign-in tests still pass; new tests cover the writes and fail-soft path.

## Scope

### In Scope

- Schema additions and `prisma db push`.
- `signInHandler` change to write `provider_payload` and `LoginEvent`.
- `GoogleWorkspaceAdminClientImpl.listUserGroups`.
- Directory enrichment in the staff sign-in path (fail-soft).
- `login-payload.ts` typed-accessor module.
- Tests.

### Out of Scope

- GitHub teams or Pike13 enrichment.
- UI for groups/OU.
- Backfill of existing `Login` rows.

## Test Strategy

Integration tests against the real test DB:
- New Google sign-in writes `provider_payload`, `provider_payload_updated_at`, `LoginEvent`.
- New GitHub sign-in writes `provider_payload` and `LoginEvent`; `directory_metadata` null.
- New Pike13 sign-in writes `provider_payload` and `LoginEvent`.
- Returning sign-in updates payload + appends new `LoginEvent`.
- `@jointheleague.org` Google sign-in with a fake admin client writes `directory_metadata = { ou_path, groups }`.
- Sign-in does NOT 500 when `listUserGroups` throws; `directory_metadata` left null/partial.
- Unit tests for `login-payload.ts`.

## Architecture Notes

- All new fields on existing `Login` plus one new model `LoginEvent`.
- `signInHandler` gets `requestContext?: { ip?: string; userAgent?: string }` argument. Auth callbacks pass `req.ip`, `req.headers['user-agent']`.
- Directory enrichment runs inside the existing Step 4 `@jointheleague.org` branch, after the OU determination, reusing the OU result.
- `login-payload.ts` is pure (no I/O).

## GitHub Issues

(None linked.)

## Definition of Ready

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Schema: Login provenance fields and LoginEvent table | — | 1 |
| 002 | signInHandler writes provider_payload and LoginEvent | 001 | 2 |
| 003 | GoogleWorkspaceAdminClientImpl listUserGroups method | — | 1 |
| 004 | Directory metadata enrichment for jointheleague.org sign-ins | 002, 003 | 3 |
| 005 | login-payload.ts typed accessor module | 001 | 2 |
| 006 | Manual smoke pass stakeholder verification | 001-005 | 4 |
