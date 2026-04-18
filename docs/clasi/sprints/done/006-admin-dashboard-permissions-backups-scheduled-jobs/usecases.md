---
status: approved
---

# Sprint 006 Use Cases

## SUC-001: Admin creates a role assignment pattern
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: Admin is logged in with ADMIN role, Permissions panel is accessible
- **Main Flow**:
  1. Admin navigates to the Permissions panel
  2. Admin clicks "Add Pattern"
  3. Admin selects match type (exact email or regex)
  4. Admin enters the pattern (e.g., `admin@example.com` or `.*@company\.org`)
  5. Admin selects the role to assign (USER or ADMIN)
  6. Admin saves the pattern
  7. System creates a `RoleAssignmentPattern` record
  8. Pattern appears in the list
- **Postconditions**: Pattern is stored and will be evaluated on future OAuth logins
- **Acceptance Criteria**:
  - [ ] Admin can create an exact-email match pattern
  - [ ] Admin can create a regex match pattern
  - [ ] Admin can edit an existing pattern
  - [ ] Admin can delete a pattern with confirmation
  - [ ] Pattern list displays match type, pattern, assigned role
  - [ ] Non-admin users receive 403 on permissions API routes

## SUC-002: Admin creates a database backup
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: Admin is logged in with ADMIN role, ImportExport panel is accessible
- **Main Flow**:
  1. Admin navigates to the Import/Export panel
  2. Admin clicks "Create Backup"
  3. System runs `pg_dump` and stores the result in the backup directory
  4. System records backup metadata (timestamp, size, filename)
  5. Backup appears in the backup list with timestamp and file size
- **Postconditions**: A `pg_dump` backup file exists in the backup directory
- **Acceptance Criteria**:
  - [ ] Backup is created and stored locally
  - [ ] Backup list shows filename, timestamp, and file size
  - [ ] Admin can delete a backup with confirmation
  - [ ] API returns 403 for non-admin users

## SUC-003: Admin exports database as JSON
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: Admin is logged in with ADMIN role, ImportExport panel is accessible
- **Main Flow**:
  1. Admin navigates to the Import/Export panel
  2. Admin clicks "Export JSON"
  3. System queries all tables via Prisma and serializes to JSON
  4. Browser downloads the JSON file
- **Postconditions**: Admin has a JSON file containing all database records
- **Acceptance Criteria**:
  - [ ] JSON export includes all application tables
  - [ ] Downloaded file is valid JSON
  - [ ] Export includes metadata (timestamp, table counts)
  - [ ] API returns 403 for non-admin users

## SUC-004: Admin restores from a backup
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: Admin is logged in, at least one backup exists in the backup list
- **Main Flow**:
  1. Admin navigates to the Import/Export panel
  2. Admin selects a backup from the list
  3. Admin clicks "Restore" and confirms the action
  4. System restores the database from the selected `pg_dump` backup
  5. System displays success or error message
- **Postconditions**: Database state matches the backup contents
- **Acceptance Criteria**:
  - [ ] Restore requires explicit confirmation (destructive action)
  - [ ] Restore replaces current database contents with backup data
  - [ ] System reports success or failure with details
  - [ ] API returns 403 for non-admin users

## SUC-005: Admin views and manages scheduled jobs
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: Admin is logged in, ScheduledJob records exist (seeded or created)
- **Main Flow**:
  1. Admin navigates to the Scheduled Jobs panel
  2. Panel displays all jobs with name, frequency, enabled status, last run, next run, and last error
  3. Admin toggles a job's enabled/disabled state
  4. Admin clicks "Run Now" on a specific job
  5. System executes the job immediately and updates last run time
  6. Panel refreshes to show updated status
- **Postconditions**: Job state reflects the admin's changes
- **Acceptance Criteria**:
  - [ ] Jobs list shows name, frequency, enabled, last run, next run, last error
  - [ ] Admin can enable/disable a job via toggle
  - [ ] Admin can trigger immediate execution with "Run Now"
  - [ ] Panel auto-refreshes every 30 seconds
  - [ ] Seeded jobs (`daily-backup`, `weekly-backup`) appear on first run
  - [ ] API returns 403 for non-admin users

## SUC-006: Scheduled job runs automatically when due
Parent: N/A (admin infrastructure)

- **Actor**: System (SchedulerService)
- **Preconditions**: At least one enabled job has a `nextRun` in the past, a handler is registered for that job
- **Main Flow**:
  1. Scheduler tick fires (interval or middleware-driven)
  2. SchedulerService queries for due jobs (`nextRun <= now AND enabled = true`)
  3. Service locks the job row with `FOR UPDATE SKIP LOCKED`
  4. Service executes the registered handler for the job
  5. On success: updates `lastRun`, calculates and sets `nextRun`, clears `lastError`
  6. On failure: updates `lastRun`, sets `lastError` with the error message
- **Postconditions**: Job has been executed, `lastRun` and `nextRun` are updated
- **Acceptance Criteria**:
  - [ ] Due jobs are found and executed automatically
  - [ ] `FOR UPDATE SKIP LOCKED` prevents double-execution
  - [ ] `lastRun` is updated after execution
  - [ ] `nextRun` is recalculated based on frequency
  - [ ] `lastError` is set on failure, cleared on success
  - [ ] Disabled jobs are not executed
