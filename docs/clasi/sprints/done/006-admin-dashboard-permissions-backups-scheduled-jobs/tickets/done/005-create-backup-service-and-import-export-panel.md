---
id: '005'
title: Create backup service and import/export panel
status: todo
use-cases:
- SUC-002
- SUC-003
- SUC-004
depends-on: []
---

# Create backup service and import/export panel

## Description

Create the `BackupService` for database backup/restore/export operations,
the admin API routes for backups and JSON export, and the `ImportExport`
React component. This provides administrators with the ability to create
`pg_dump` backups, download JSON exports, and manage backup lifecycle.

### Changes

1. **`server/src/services/backup.service.ts`** — Create `BackupService`:
   - `createBackup()` — Run `pg_dump` using `DATABASE_URL`, write output to
     the backup directory (`BACKUP_DIR` env var, default `data/backups/`).
     Filename format: `backup-YYYY-MM-DDTHH-mm-ss.sql`. Create the directory
     if it does not exist. Return metadata (filename, timestamp, size).
   - `listBackups()` — Read the backup directory, return metadata for each
     file (filename, size in bytes, created timestamp).
   - `restoreBackup(filename)` — Run `psql` or `pg_restore` with the selected
     backup file against `DATABASE_URL`. Validate that the filename exists.
     Return success/error result.
   - `deleteBackup(filename)` — Remove the specified file from the backup
     directory. Validate the filename to prevent path traversal.
   - `exportJson()` — Query all application tables via Prisma client. Return
     a JSON object with table names as keys and record arrays as values.
     Include metadata: `{ exportedAt, tables: { tableName: { count, records } } }`.
   - Register in `ServiceRegistry` as `backups`.

2. **`server/src/routes/admin/backups.ts`** — Admin API routes:
   - `POST /api/admin/backups` — Create a backup. Returns backup metadata.
   - `GET /api/admin/backups` — List all backups. Returns JSON array.
   - `POST /api/admin/backups/:id/restore` — Restore from backup. Request
     body must include `{ confirm: true }`. Returns result.
   - `DELETE /api/admin/backups/:id` — Delete a backup file. Returns 204.
   - `GET /api/admin/export/json` — Export database as JSON download. Sets
     `Content-Disposition` header for file download.
   - All routes use `requireAdmin` middleware.

3. **Mount routes** in the admin route index file.

4. **`client/src/components/admin/ImportExport.tsx`** — React component:
   - "Export JSON" button — triggers download via the export endpoint.
   - "Create Backup" button — calls POST backup endpoint, refreshes list.
   - Backup list table with columns: filename, timestamp, file size.
   - Per-backup actions: "Restore" (with confirmation dialog warning this is
     destructive), "Delete" (with confirmation).
   - Status messages for async operations (creating, restoring, etc.).
   - Loading and error states.

5. **Register the panel** in the admin dashboard page/layout.

6. **Add `data/` to `.gitignore`** if not already present.

7. **Wire up scheduler handlers** — Update the `daily-backup` and
   `weekly-backup` handler registrations in `server/src/index.ts` to call
   `BackupService.createBackup()` instead of no-op placeholders.

### Security

- Validate filenames in `restoreBackup` and `deleteBackup` to prevent path
  traversal (reject filenames containing `..` or `/`).
- `pg_dump` credentials come from `DATABASE_URL`; never log or return them.
- Restore endpoint requires `confirm: true` in request body.

## Acceptance Criteria

- [ ] `BackupService.createBackup()` runs `pg_dump` and stores file locally
- [ ] `BackupService.listBackups()` returns metadata for all backup files
- [ ] `BackupService.restoreBackup()` restores database from a backup file
- [ ] `BackupService.deleteBackup()` removes a backup file safely
- [ ] `BackupService.exportJson()` returns all tables as structured JSON
- [ ] Backup directory is created automatically if missing
- [ ] Filename validation prevents path traversal attacks
- [ ] Restore requires `confirm: true` in request body
- [ ] All admin routes return 403 for non-admin users
- [ ] All admin routes return 401 for unauthenticated requests
- [ ] `ImportExport` panel renders export button, create button, and backup list
- [ ] JSON export triggers a file download in the browser
- [ ] Restore and delete actions require confirmation
- [ ] `BackupService` is registered in `ServiceRegistry`
- [ ] Scheduler handlers for `daily-backup` and `weekly-backup` call
      `BackupService.createBackup()`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Verification command**: `cd server && npx tsc --noEmit`
