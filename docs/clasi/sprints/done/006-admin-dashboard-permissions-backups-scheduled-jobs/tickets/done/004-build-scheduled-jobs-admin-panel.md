---
id: '004'
title: Build scheduled jobs admin panel
status: todo
use-cases:
- SUC-005
depends-on:
- '003'
---

# Build scheduled jobs admin panel

## Description

Create the admin API routes for scheduled job management and the
`ScheduledJobsPanel` React component. This gives administrators visibility
into scheduled jobs and the ability to enable, disable, and manually trigger
them.

### Changes

1. **`server/src/routes/admin/scheduler.ts`** — Admin API routes:
   - `GET /api/admin/scheduler/jobs` — List all scheduled jobs. Returns JSON
     array with id, name, frequency, enabled, lastRun, nextRun, lastError.
   - `PUT /api/admin/scheduler/jobs/:id` — Update a job (primarily
     enable/disable). Request body: `{ enabled }`. Returns updated job.
   - `POST /api/admin/scheduler/jobs/:id/run` — Trigger immediate execution
     of a job via `SchedulerService.runJobNow(id)`. Returns the updated job.
   - All routes use `requireAdmin` middleware.

2. **Mount routes** in the admin route index file.

3. **`client/src/components/admin/ScheduledJobsPanel.tsx`** — React component:
   - Table listing all jobs with columns: name, frequency, enabled (toggle),
     last run (formatted timestamp), next run (formatted timestamp), last
     error (highlighted if non-null).
   - Enable/disable toggle per job row (calls PUT endpoint).
   - "Run Now" button per job row (calls POST run endpoint).
   - Auto-refresh every 30 seconds using `setInterval` / `useEffect`.
   - Loading and error states.

4. **Register the panel** in the admin dashboard page/layout.

5. **Seed default jobs** if not already done in ticket 003 — ensure
   `daily-backup` and `weekly-backup` appear on first load.

## Acceptance Criteria

- [ ] `GET /api/admin/scheduler/jobs` returns all jobs as JSON
- [ ] `PUT /api/admin/scheduler/jobs/:id` toggles enabled/disabled state
- [ ] `POST /api/admin/scheduler/jobs/:id/run` triggers immediate execution
- [ ] All routes return 403 for non-admin users
- [ ] All routes return 401 for unauthenticated requests
- [ ] `ScheduledJobsPanel` renders the jobs list with all columns
- [ ] Enable/disable toggle updates the job and refreshes the display
- [ ] "Run Now" button triggers execution and shows updated last run time
- [ ] Panel auto-refreshes every 30 seconds
- [ ] Last error column highlights non-null values visually

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Verification command**: `cd server && npx tsc --noEmit`
