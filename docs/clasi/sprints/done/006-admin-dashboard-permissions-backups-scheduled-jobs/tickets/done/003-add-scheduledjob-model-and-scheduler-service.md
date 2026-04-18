---
id: '003'
title: Add ScheduledJob model and scheduler service
status: todo
use-cases:
- SUC-005
- SUC-006
depends-on: []
---

# Add ScheduledJob model and scheduler service

## Description

Add the `ScheduledJob` Prisma model and create a `SchedulerService` that
manages job execution using a tick-based interval with `FOR UPDATE SKIP LOCKED`
concurrency control. This provides the backend infrastructure for running
periodic tasks like automated backups.

### Changes

1. **`server/prisma/schema.prisma`** — Add the `ScheduledJob` model:
   ```prisma
   model ScheduledJob {
     id        Int       @id @default(autoincrement())
     name      String    @unique
     frequency String    // 'daily', 'weekly', 'hourly'
     enabled   Boolean   @default(true)
     lastRun   DateTime?
     nextRun   DateTime?
     lastError String?
     createdAt DateTime  @default(now())
     updatedAt DateTime  @updatedAt
   }
   ```

2. **Run `npx prisma migrate dev`** to generate the migration.

3. **`server/src/services/scheduler.service.ts`** — Create `SchedulerService`:
   - `registerHandler(jobName, handler)` — Register an async handler function
     for a named job. Called at application startup.
   - `tick()` — Query for enabled jobs where `nextRun <= NOW()` using a raw
     query with `FOR UPDATE SKIP LOCKED` to prevent double-execution:
     ```sql
     SELECT * FROM "ScheduledJob"
     WHERE enabled = true AND "nextRun" <= NOW()
     FOR UPDATE SKIP LOCKED
     ```
     For each locked job, execute the registered handler, update `lastRun`,
     recalculate `nextRun`, and clear or set `lastError`.
   - `runJobNow(id)` — Execute a job immediately regardless of schedule.
     Update `lastRun` and recalculate `nextRun`.
   - `calculateNextRun(frequency, fromDate)` — Pure function: adds 1 hour,
     1 day, or 1 week to `fromDate` based on frequency string.
   - `startTicking()` — Start a `setInterval` that calls `tick()` every
     60 seconds. Store the interval handle for cleanup.
   - `stopTicking()` — Clear the interval (important for tests).

4. **Seed default jobs** — Create an idempotent seed (upsert by `name`):
   - `daily-backup`: frequency `daily`, enabled `true`
   - `weekly-backup`: frequency `weekly`, enabled `true`
   Set `nextRun` to the next appropriate time based on frequency.

5. **`server/src/index.ts`** — On server boot:
   - Register default handlers: `daily-backup` and `weekly-backup` both call
     `BackupService.createBackup()` (wire up after ticket 005 is done; for
     now, register a no-op placeholder).
   - Call `startTicking()`.
   - On shutdown (SIGTERM/SIGINT), call `stopTicking()`.

6. **Register `SchedulerService`** in `ServiceRegistry` as `scheduler`.

## Acceptance Criteria

- [ ] `ScheduledJob` model exists in Prisma schema with all specified fields
- [ ] Migration runs cleanly on a fresh database
- [ ] `calculateNextRun` correctly computes next run for hourly, daily, weekly
- [ ] `tick()` finds due jobs and locks them with `FOR UPDATE SKIP LOCKED`
- [ ] `tick()` executes registered handlers and updates `lastRun`/`nextRun`
- [ ] `tick()` sets `lastError` on handler failure, clears it on success
- [ ] `tick()` skips jobs with no registered handler
- [ ] `runJobNow(id)` executes immediately and updates timestamps
- [ ] Disabled jobs are not picked up by `tick()`
- [ ] Default jobs (`daily-backup`, `weekly-backup`) are seeded idempotently
- [ ] `startTicking()` / `stopTicking()` manage the interval lifecycle
- [ ] `SchedulerService` is registered in `ServiceRegistry`
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Verification command**: `cd server && npx tsc --noEmit`
