---
id: '007'
title: Write admin dashboard tests
status: todo
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
depends-on:
- '001'
- '002'
- '003'
- '004'
- '005'
- '006'
---

# Write admin dashboard tests

## Description

Write comprehensive server-side tests for all new admin dashboard API routes
and services added in Sprint 006. Tests follow the project's established
patterns: `POST /api/auth/test-login` for auth bypass, `request.agent(app)`
for session persistence, and database assertions via Prisma queries.

### Test Files

1. **`tests/server/admin/permissions.test.ts`** — Permissions CRUD:
   - `GET /api/admin/permissions/patterns` returns empty array initially
   - `POST /api/admin/permissions/patterns` creates an exact-match pattern
   - `POST /api/admin/permissions/patterns` creates a regex pattern
   - `POST /api/admin/permissions/patterns` rejects invalid regex
   - `PUT /api/admin/permissions/patterns/:id` updates a pattern
   - `DELETE /api/admin/permissions/patterns/:id` deletes a pattern
   - Verify database state after each mutation (Prisma query)
   - Returns 403 for non-admin authenticated user
   - Returns 401 for unauthenticated request

2. **`tests/server/admin/backups.test.ts`** — Backup and export:
   - `POST /api/admin/backups` creates a backup file
   - `GET /api/admin/backups` lists backups with metadata
   - `POST /api/admin/backups/:id/restore` restores a backup (with confirm)
   - `POST /api/admin/backups/:id/restore` rejects without confirm flag
   - `DELETE /api/admin/backups/:id` removes a backup file
   - `GET /api/admin/export/json` returns valid JSON with all tables
   - JSON export includes metadata (timestamp, table counts)
   - Returns 403 for non-admin authenticated user
   - Returns 401 for unauthenticated request

3. **`tests/server/admin/scheduler.test.ts`** — Scheduled jobs:
   - `GET /api/admin/scheduler/jobs` lists seeded jobs
   - `PUT /api/admin/scheduler/jobs/:id` toggles enabled/disabled
   - `POST /api/admin/scheduler/jobs/:id/run` triggers execution
   - Verify `lastRun` is updated after manual run
   - Verify database state matches API responses
   - Returns 403 for non-admin authenticated user
   - Returns 401 for unauthenticated request

4. **`tests/server/admin/environment.test.ts`** — Enhanced environment:
   - Environment endpoint includes `integrations` object
   - Integration status reflects actual env var presence
   - Returns 403 for non-admin authenticated user

5. **`tests/server/admin/sessions.test.ts`** — Enhanced sessions:
   - Sessions endpoint includes user info (email, name, role)
   - Sessions endpoint includes expiry timestamp
   - Returns 403 for non-admin authenticated user

### Test Patterns

- Use `POST /api/auth/test-login` with `{ role: 'ADMIN' }` for admin access
- Use `POST /api/auth/test-login` with `{ role: 'USER' }` for non-admin 403 tests
- Use `request.agent(app)` for session cookie persistence
- Assert HTTP response status and body
- Assert database state via Prisma queries after mutations
- Clean up test data between tests (truncate relevant tables)

## Acceptance Criteria

- [ ] Permissions CRUD tests pass (create, list, update, delete patterns)
- [ ] Permissions tests verify invalid regex rejection
- [ ] Backup tests cover create, list, restore, delete operations
- [ ] Backup restore test verifies `confirm: true` requirement
- [ ] JSON export test verifies valid JSON with metadata
- [ ] Scheduler tests cover list, toggle, and run-now operations
- [ ] Environment test verifies integration status in response
- [ ] Session test verifies linked user info in response
- [ ] All admin routes tested for 403 on non-admin access
- [ ] All admin routes tested for 401 on unauthenticated access
- [ ] All tests pass: `npm run test:server`
- [ ] No regressions in existing test suites

## Testing

- **Existing tests to run**: `npm run test:server` (full suite)
- **New tests to write**: This ticket IS the test ticket
- **Verification command**: `npm run test:server`
