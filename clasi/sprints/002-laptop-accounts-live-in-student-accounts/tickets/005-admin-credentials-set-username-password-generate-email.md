---
id: '005'
title: 'Admin credentials: set username/password, generate, email'
status: in-progress
use-cases:
- SUC-003
depends-on:
- '004'
github-issue: ''
issue: admin-set-username-password-and-email-credentials.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin credentials: set username/password, generate, email

## Description

Give administrators the controls they lack on a student: set the username, set or generate a password, and email the credentials to an address of their choosing. Server endpoints plus a "Credentials" card on the admin user detail panel. Reuses the username validation and laptop write-back from ticket 004.

## Acceptance Criteria

- [ ] `UserService.setCredentialsByAdmin(userId, { username?, password?, generatePassword? }, actorId)`: validates the username (ticket 004 rules when `allows_laptop_account`), hashes with scrypt + `makeCryptHash`, creates the `username` Login row if the user has none (`provider_user_id: 'admin:<userId>:<username>'`, mirroring `routes/account.ts:498`), audits `admin_set_username` / `admin_set_password` (never the password), calls `laptopAccounts.reconcile`, returns `{ username, password? }` with the plaintext only when generated/set in this call.
- [ ] `PUT /api/admin/users/:id/credentials` (admin; `server/src/routes/admin/credentials.ts`, mounted in `app.ts`) → that result; 400 with the validation message on bad username; 404 unknown user.
- [ ] `POST /api/admin/users/:id/credentials/email` body `{ to: string, password?: string, note?: string }`: validates `to` as an email and refuses `*.invalid`; sends "Your League account" via `mail.service.ts` (new template: display name, username, password if present, the site URL for signing in, and, when `allows_laptop_account` and a roster entry would exist, the line "On a League laptop, choose Other... at the login screen and use this username and password."; optional note); audits `credentials_emailed` with the recipient (not the password). Returns `{ sent: true }` or the mail service's skipped result.
- [ ] Client `client/src/pages/admin/UserCredentialsCard.tsx` on `UserDetailPanel.tsx`: username field + Save; "Set password" (typed, min 4 chars, confirm field) and "Generate" (calls the endpoint with `generatePassword: true`, shows the result once with Copy); "Email credentials…" dialog: To (prefilled `notification_email ?? primary_email`, empty when it ends in `.invalid`), "Include the password I just set" checkbox (enabled only when a plaintext is in component state), note, Send; toasts; plaintext cleared from state after send or unmount.
- [ ] Tests: route tests (403 non-admin; set username validation incl. laptop rule; set password then `POST /api/auth/login` works; generate returns a 3-word password and login works; email endpoint calls a fake mail transport with username/password/recipient and refuses `.invalid`; audit rows present without the password); client test for the card (generate shows once, email dialog prefill and `.invalid` empty).

## Testing

- **Existing tests to run**: full server suite; `tests/client/` admin tests.
- **New tests to write**: `tests/server/routes/admin/credentials.test.ts`, `tests/client/UserCredentialsCard.test.tsx`.
- **Verification command**: `npm run test:server && npm run test:client && (cd server && npx tsc --noEmit) && (cd client && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
