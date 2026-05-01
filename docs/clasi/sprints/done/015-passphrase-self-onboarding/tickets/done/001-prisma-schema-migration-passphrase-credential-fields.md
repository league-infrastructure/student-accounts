---
id: '001'
title: "Prisma schema migration \u2014 passphrase + credential fields"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
depends-on: []
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 001 — Prisma schema migration: passphrase + credential fields

## Description

Add the schema fields that every subsequent ticket depends on. No application code is written here — only the data model and the dev-DB push. This makes the rest of the sprint compilable from the start.

## Acceptance Criteria

- [x] `server/prisma/schema.prisma`: `Group` model gains five new fields:
  - `signup_passphrase  String?`
  - `signup_passphrase_grant_llm_proxy  Boolean  @default(false)`
  - `signup_passphrase_expires_at  DateTime?`
  - `signup_passphrase_created_at  DateTime?`
  - `signup_passphrase_created_by  Int?`
- [x] `server/prisma/schema.prisma`: `Cohort` model gains the same five fields (identical names and types).
- [x] `server/prisma/schema.prisma`: `User` model gains:
  - `username  String?  @unique`
  - `password_hash  String?`
- [x] Dev DB updated — `prisma/sqlite-push.sh` (or `npx prisma db push`) runs without error.
- [x] `npx prisma generate` produces an updated Prisma client with no errors.
- [x] `npx tsc --noEmit` in `server/` shows no new errors beyond the pre-existing 25.
- [x] `npm run test:server` full suite passes (no regressions from schema change).

## Implementation Plan

### Approach

Purely additive — all new fields are nullable (or have a default), so existing rows are unaffected. The dev DB is disposable; use `prisma db push` (not `migrate dev`) per CLAUDE.md convention.

### Files to Modify

- `server/prisma/schema.prisma` — add fields to `Group`, `Cohort`, and `User` models.

### Steps

1. Open `server/prisma/schema.prisma`.
2. Locate the `Group` model. Add the five `signup_passphrase*` fields after the existing group fields.
3. Locate the `Cohort` model. Add the same five fields.
4. Locate the `User` model. Add `username` and `password_hash`.
5. Run `prisma/sqlite-push.sh` (or `cd server && npx prisma db push`) to apply to dev DB.
6. Run `cd server && npx prisma generate` to regenerate the Prisma client.
7. Run `npx tsc --noEmit` in `server/` — confirm no new errors.
8. Run `npm run test:server` — confirm no regressions.

### Testing Plan

- No new test files in this ticket.
- Run `npm run test:server` to confirm existing tests are unaffected.
- Verify `npx prisma validate` exits 0.

### Documentation Updates

None. Schema is self-documenting.
