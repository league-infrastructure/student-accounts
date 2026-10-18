---
id: '004'
title: 'Laptop account write-back: LaptopAccountService, hooks, username rules, push
  job'
status: in-progress
use-cases:
- SUC-002
- SUC-007
depends-on:
- '001'
- '002'
github-issue: ''
issue: laptop-account-management-in-student-accounts.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Laptop account write-back: LaptopAccountService, hooks, username rules, push job

## Description

After the import, this app is the source of truth for laptop logins and must write the roster. `LaptopAccountService.reconcile(userId)` decides whether a user should have a roster entry and writes (or locks) it; it is called from every place credentials, status or the flag change. Username rules match the laptops. Failures never block the user's action: a dirty flag plus an hourly job retries and backs an admin "Push all".

## Acceptance Criteria

- [ ] Prisma: `User.allows_laptop_account Boolean @default(true)`, `User.laptop_roster_dirty Boolean @default(false)`; migration + generated client.
- [ ] `server/src/services/laptop/laptop-account.service.ts`: `LaptopAccountService(roster, prisma, audit)` with:
  - `desiredEntry(user, existing?)`: eligible = `is_active && allows_laptop_account && role !== 'admin' (staff allowed) && username && laptop_password_hash && isValidRosterId(username)`. Eligible → `{ id: username, display_name, password_hash: laptop_password_hash, created: existing?.created ?? now, created_host: existing?.created_host ?? 'student-accounts', managed_by: 'student-accounts', updated: now }`. Not eligible but an entry exists (or the user once had one) → same shape with `password_hash: '!'`. No username → nothing to write. Timestamps `YYYYMMDDTHHMMSSZ` like `league-helper`.
  - `reconcile(userId)`: read existing, compute desired, write only if `password_hash`/`display_name` differ (or no entry); set `laptop_roster_dirty=false` on success; on any error log, set `laptop_roster_dirty=true`, do not throw. Audit `laptop_roster_written` / `laptop_roster_locked`.
  - `pushAll()`: reconcile every user with a username; returns `{ written, locked, unchanged, failed }`.
  - `rosterIdTakenByOther(username, userId)`: true if the roster has an entry for `username` and no user here with that username except `userId` (used by validation below).
- [ ] Password set paths compute and store `laptop_password_hash = makeCryptHash(plaintext)` alongside scrypt: `UserService` credentials/password change (`server/src/services/user.service.ts` ~L169-216), `PATCH /api/account/credentials` (`routes/account.ts`), passphrase signup credentials (`services/auth/passphrase-signup.handler.ts`), admin set-password (ticket 005 will call the same `UserService` method). Each then calls `laptopAccounts.reconcile(userId)` (await, it never throws).
- [ ] Also call `reconcile` after: username change, display-name change, `is_active` change, `allows_laptop_account` change (admin permissions route `routes/admin/users.ts`; add the new flag to the permissions PATCH + validation).
- [ ] Username validation: when `allows_laptop_account` is true, a new/changed username must satisfy `isValidRosterId` and `!rosterIdTakenByOther`; error messages: "Usernames for laptop login are 3-32 characters: lowercase letters, digits and dashes, starting with a letter or digit." / "That username is already used on the League laptops by someone else." Users whose current username is invalid are not blocked from anything else; the Account/admin cards (ticket 006) show the state.
- [ ] Job: `server/src/jobs/laptop-roster-push.job.ts` exporting `JOB_NAME = 'laptop-roster-push'`, `JOB_FREQUENCY = 'hourly'`, `createLaptopRosterPushJobHandler(deps)` which reconciles users with `laptop_roster_dirty = true`; registered in `server/src/index.ts`; added to `seedDefaults` in `scheduler.service.ts` (enabled by default).
- [ ] `POST /api/admin/laptop/push-all` (admin; `routes/admin/laptop.ts`) → `pushAll()` result; audit `laptop_push_all`.
- [ ] `service.registry.ts` wires `laptopAccounts`.
- [ ] Tests with `FakeLaptopRosterClient`: set credentials → entry written with a `$6$` hash that `verifyCryptHash` accepts for the plaintext, `created_host: student-accounts`; change password → new hash, `created` preserved; deactivate → `!`; flag off → `!`; flag on → real hash; `failWrites` → user action succeeds, `laptop_roster_dirty` true, job run with writes restored clears it; username rules (`Alice`, `student`, `ab` rejected; id present in fake roster for another user rejected; `alice-2` accepted); `pushAll` counts.

## Testing

- **Existing tests to run**: full server suite, especially `tests/server/routes/account*.test.ts`, `tests/server/admin-user-permissions.routes.test.ts`, `tests/server/admin-scheduler.test.ts`, passphrase signup tests.
- **New tests to write**: `tests/server/services/laptop-account.service.test.ts`, `tests/server/jobs/laptop-roster-push.job.test.ts`, `tests/server/routes/admin/laptop.test.ts`, username-rule cases in the credentials route tests.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
