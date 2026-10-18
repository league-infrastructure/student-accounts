---
id: '001'
title: 'Password utils: SHA-512 crypt verify/make, laptop_password_hash, laptop_import,
  .invalid mail guard'
status: in-progress
use-cases:
- SUC-001
- SUC-002
depends-on: []
github-issue: ''
issue: import-laptop-roster-into-botball-26-group.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Password utils: SHA-512 crypt verify/make, laptop_password_hash, laptop_import, .invalid mail guard

## Description

Foundation for laptop logins. The laptops verify passwords with glibc SHA-512 crypt (`$6$rounds?$salt$hash`); this app uses scrypt (`saltHex:keyHex`, `server/src/utils/password.ts`). Add a crypt implementation so this app can (a) verify the hashes the one-time import brings in and (b) produce hashes the laptops accept when a password is set here. Add the data-model pieces the next tickets need, and stop mail from ever being sent to the synthesised `*.invalid` addresses imported accounts get.

## Acceptance Criteria

- [ ] `server/src/utils/password.ts` exports `isCryptHash(h)`, `verifyCryptHash(password, h)`, `makeCryptHash(password, rounds?)` implementing SHA-512 crypt per the glibc spec (default 5000 rounds, 16-char salt from `[./0-9A-Za-z]`), constant-time comparison. Implement with `node:crypto` (no new dependency) or a small well-known pure-JS package if one is already in the lockfile; document the choice in the file header.
- [ ] A fixture test verifies `verifyCryptHash` against a hash produced by `openssl passwd -6` (generate once during implementation, paste the hash and plaintext into the test), and that `makeCryptHash` output round-trips through `verifyCryptHash` and has the `$6$` shape.
- [ ] `verifyPassword(password, stored)` dispatches: `$6$` → crypt verifier; `salt:key` → existing scrypt; anything else (`!`, `*`, empty, malformed) → false. Existing scrypt tests still pass.
- [ ] `generatePassword()` returns three lowercase words joined by `-` from a small embedded wordlist (~200 words), e.g. `maple-robot-seven`; test asserts shape and randomness.
- [ ] Prisma: `User.laptop_password_hash String?`, `CreatedVia.laptop_import`; migration created; generated client updated.
- [ ] `POST /api/auth/login` (`server/src/routes/auth/login.ts`): when the stored `password_hash` is a `$6$` hash and verification succeeds, rehash to scrypt and, if `laptop_password_hash` is null, copy the `$6$` hash there. Test: seed a user with a `$6$` `password_hash`, log in, assert `password_hash` now scrypt-shaped and `laptop_password_hash` set.
- [ ] `server/src/services/mail.service.ts`: refuse to send to any address whose domain ends in `.invalid` (log at info, return a "skipped" result rather than throwing); unit test.
- [ ] Full server suite green (apart from the pre-existing failures listed in the sprint's `docs` note, if any), `tsc --noEmit` clean.

## Testing

- **Existing tests to run**: `npm run test:server` (notably `tests/server/routes/auth-login.test.ts`, anything under `tests/server/utils/`).
- **New tests to write**: `tests/server/utils/password.test.ts` (crypt fixture, dispatch, generatePassword), extend `tests/server/routes/auth-login.test.ts` (crypt login + rehash), `tests/server/services/mail.service.test.ts` (or extend) for the `.invalid` guard.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
