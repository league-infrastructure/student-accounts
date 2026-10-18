---
id: '002'
title: Spaces client extraction and LaptopRosterClient
status: done
use-cases:
- SUC-001
- SUC-002
depends-on: []
github-issue: ''
issue: import-laptop-roster-into-botball-26-group.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Spaces client extraction and LaptopRosterClient

## Description

One Spaces (S3) client for the app, and a small roster client over it. `server/src/services/backup.service.ts` builds its own `S3Client` from `DO_SPACES_*` env vars; extract that into `server/src/services/spaces/s3-client.ts` so the roster code reuses it. Then add `LaptopRosterClient` with `listIds()`, `read(id)`, `write(id, entry)` over bucket `LAPTOP_ROSTER_BUCKET` and the layout `students/<id>/config.json`. Nothing in this ticket touches users.

## Acceptance Criteria

- [x] `server/src/services/spaces/s3-client.ts` exports `buildS3Client(opts?)` reading `DO_SPACES_ENDPOINT`, `DO_SPACES_KEY`, `DO_SPACES_SECRET`, `DO_SPACES_REGION` (default `sfo3`), `forcePathStyle: false`; `backup.service.ts` uses it and its tests still pass.
- [x] `server/src/services/laptop/laptop-roster.client.ts`: class `LaptopRosterClient` with constructor `(opts: { bucket: string; s3Client?: S3Client })` (test seam like the backup service), methods `listIds(): Promise<string[]>` (paginated `ListObjectsV2` with `Prefix: 'students/'`, `Delimiter: '/'`, returning the `<id>` segments), `read(id): Promise<RosterEntry | null>` (GetObject `students/<id>/config.json`, JSON-parsed, `null` on NoSuchKey/404), `write(id, entry: RosterEntry): Promise<void>` (PutObject, `ContentType: application/json`, `ACL: private`, 1-space indented JSON like `league-helper` writes). `RosterEntry` type: `{ id, display_name, password_hash, created, created_host, managed_by?, updated?, renamed_from? }`.
- [x] Id validation at the boundary: `isValidRosterId(id)` (`/^[a-z0-9][a-z0-9-]{2,31}$/` and not in the reserved list `student root ansible ubuntu admin adm daemon nobody gdm sync bin sys`) exported from `server/src/services/laptop/roster-ids.ts`; `read`/`write` throw on an invalid id so no path can escape `students/`.
- [x] `server/src/services/config.ts` `CONFIG_KEYS` gains `DO_SPACES_ENDPOINT`, `DO_SPACES_KEY` (secret), `DO_SPACES_SECRET` (secret), `DO_SPACES_REGION`, `LAPTOP_ROSTER_BUCKET` (group "Laptop accounts", default `jtl-student-unix-accounts`, `requiresRestart: false`). `config/dev/public.env.example` and `config/prod/public.env.example` (or the matching templates that exist) document `LAPTOP_ROSTER_BUCKET`.
- [x] `tests/server/helpers/fake-laptop-roster.client.ts`: an in-memory `FakeLaptopRosterClient` implementing the same interface (`Map<string, RosterEntry>`, records `writes: Array<{id, entry}>`, optional `failWrites` flag to simulate Spaces outages). Later tickets use it.
- [x] Unit tests for the real client against an injected fake `S3Client` (`{ send: vi.fn() }` as in `tests/server/backup.service.test.ts`): listIds pagination, read null on NoSuchKey, write body shape, invalid id rejected.
- [x] `service.registry.ts` constructs a `LaptopRosterClient` as `registry.laptopRoster` (only when `DO_SPACES_KEY` is set; otherwise a stub that throws a clear "not configured" error).

## Testing

- **Existing tests to run**: `tests/server/backup.service.test.ts`, full suite.
- **New tests to write**: `tests/server/services/laptop-roster.client.test.ts`, `tests/server/services/roster-ids.test.ts`.
- **Verification command**: `npm run test:server && (cd server && npx tsc --noEmit)`

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
