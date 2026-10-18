---
id: '003'
title: One-time laptop roster import (service, admin endpoint, script)
status: open
use-cases: [SUC-001]
depends-on: ['001', '002']
github-issue: ''
issue: import-laptop-roster-into-botball-26-group.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# One-time laptop roster import (service, admin endpoint, script)

## Description

The one-time import of the laptop roster into this app. For each `students/<id>/config.json`, create a user with that username, the `$6$` password hash as-is, a `username` Login row (the same representation passphrase signup uses), membership in a named group (default **"Botball 26"**), and run the merge scan so duplicates of Google/GitHub users show up in the merge queue. Exposed as an admin endpoint with a button, and as a script. Idempotent.

## Acceptance Criteria

- [ ] `server/src/services/laptop/laptop-roster-import.service.ts`: `LaptopRosterImportService` with constructor `(roster: LaptopRosterClient, prisma, groupService, audit, mergeScan)` and `importAll(actorId: number | null, opts: { groupName: string }): Promise<ImportReport>` where `ImportReport = { created: number; matched: number; skipped: number; errors: number; details: Array<{ id: string; outcome: 'created'|'matched'|'skipped'|'error'; reason?: string }> }`.
- [ ] Per entry: invalid/reserved id → `skipped`; entry with no `$`-prefixed `password_hash` → `created` but with `password_hash` and `laptop_password_hash` null (user cannot sign in until an admin sets a password; `reason: 'no usable hash'`); `User.username == id` already exists → `matched` (nothing changed); otherwise create in one transaction: `User { username: id, display_name: entry.display_name || id, password_hash: entry.password_hash, laptop_password_hash: entry.password_hash, role: 'student', created_via: 'laptop_import', approval_status: 'approved', is_active: true, primary_email: `${id}@laptop.invalid`, allows_llm_proxy: true }`, `Login { provider: 'username', provider_user_id: `laptop-import:${id}`, provider_username: id, provider_payload: { created, created_host } }`, group membership (create the group by name if missing, reusing `GroupService`/`bulk-group.service.ts` helpers), audit `create_user` with `{ source: 'laptop_import' }`. Then `await mergeScan(user)` outside the transaction, errors swallowed and counted in `details[].reason`.
- [ ] `POST /api/admin/import/laptop-roster` (admin only; `server/src/routes/admin/import.ts`, mounted in `app.ts`) body `{ groupName?: string }` (default "Botball 26") → `200 ImportReport`; `503` with a clear message when the roster client is not configured. Audit `laptop_roster_imported` with the counts.
- [ ] Script: `server/src/scripts/import-laptop-roster.ts` runnable as `npm run import:laptop-roster -- --group "Botball 26"` from `server/` (add the npm script), printing the report; exits non-zero on `errors > 0`.
- [ ] Admin UI: on `client/src/pages/admin/AdminUsersPanel.tsx` (toolbar) a button "Import laptop roster…" opening a small dialog: group name (prefilled "Botball 26"), explanation text, Run; shows the report (counts + a collapsible details list) and a link to the merge queue when `created > 0`. Admin-only.
- [ ] Tests with `FakeLaptopRosterClient`: three entries (one matching an existing username, one reserved id, one normal) → `created 1, matched 1, skipped 1`; second run → `matched 2, skipped 1`, no new rows; the created user has the group membership, the `username` Login, `created_via: laptop_import`, `laptop_password_hash` set; `mergeScan` called once with the new user (inject a spy); route test: 403 for a student session, 200 shape for admin.

## Testing

- **Existing tests to run**: full server suite; `tests/client/AdminUsersPanel.test.tsx`.
- **New tests to write**: `tests/server/services/laptop-roster-import.service.test.ts`, `tests/server/routes/admin/import.test.ts`, client test for the dialog (open, run, report rendered) in `tests/client/`.
- **Verification command**: `npm run test:server && npm run test:client && (cd server && npx tsc --noEmit) && (cd client && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
