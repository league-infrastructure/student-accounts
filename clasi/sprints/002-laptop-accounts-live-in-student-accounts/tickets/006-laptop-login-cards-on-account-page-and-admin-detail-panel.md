---
id: '006'
title: Laptop login cards on Account page and admin detail panel
status: open
use-cases: [SUC-006, SUC-007]
depends-on: ['004']
github-issue: ''
issue: laptop-account-management-in-student-accounts.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Laptop login cards on Account page and admin detail panel

## Description

Surface the laptop login state to the student and the admin. A "Laptop login" card on the Account page, and a matching card on the admin user detail panel with the flag toggle, dirty state and "Push now". Also expose "Push all" for admins.

## Acceptance Criteria

- [ ] `GET /api/account` (profile) and a new `GET /api/account/laptop` return `{ enabled: boolean, state: 'ready'|'locked'|'needs_password'|'invalid_username'|'disabled', username, dirty: boolean, lastWritten?: string }` computed by `LaptopAccountService.stateFor(user)` (pure function over the user row; add it in this ticket).
- [ ] `client/src/pages/account/AccountLaptopCard.tsx` rendered in `Account.tsx`: title "Laptop login"; per state: ready → "Use username **{username}** and your password at the login screen on a League laptop: choose Other..."; needs_password → "Set a password to log in on League laptops" linking to the existing credentials/change-password flow; invalid_username → "This username can't be used on laptops. Change it to 3-32 lowercase letters, digits or dashes." with a link to the username field; locked/disabled → "Laptop login is turned off for this account. Ask an instructor."; dirty → a small "Syncing to laptops…" note.
- [ ] Admin: `client/src/pages/admin/UserLaptopCard.tsx` on `UserDetailPanel.tsx`: same state line, the `allows_laptop_account` toggle (uses the permissions PATCH from ticket 004), `laptop_roster_dirty` indicator, "Push now" button → `POST /api/admin/users/:id/laptop/push` (new; calls `reconcile`), result toast. Admin users page toolbar gains "Push all laptop logins" → `POST /api/admin/laptop/push-all` (ticket 004) with a confirm and a result toast.
- [ ] `GET /api/admin/users/:id` (detail payload) includes `allows_laptop_account`, `laptop_roster_dirty`, `laptop_login_state`.
- [ ] Tests: `stateFor` unit cases; route tests for the account endpoint and the admin push endpoint; client tests rendering each state and the admin card actions.

## Testing

- **Existing tests to run**: full server suite; `tests/client/pages/Account.test.tsx`, admin panel tests.
- **New tests to write**: `tests/server/services/laptop-account.state.test.ts`, `tests/server/routes/account.laptop.test.ts`, `tests/client/AccountLaptopCard.test.tsx`, `tests/client/UserLaptopCard.test.tsx`.
- **Verification command**: `npm run test:server && npm run test:client && (cd server && npx tsc --noEmit) && (cd client && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
