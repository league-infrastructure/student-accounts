---
status: pending
priority: high
source: inventory app (server/src/services/backup.service.ts)
---

# PostgreSQL Backup Service with S3 and Rotation

Add a full database backup service that creates pg_dump backups, stores
them locally and optionally in S3-compatible storage (DigitalOcean Spaces),
and rotates old backups on a schedule.

## Why

Any production application with a PostgreSQL database needs automated
backups. This service provides adhoc and scheduled backups, dual storage
for redundancy, and one-click restore from the admin panel.

## Components

### 1. BackupService

Create `server/src/services/backup.service.ts`:

**Methods:**

- `createBackup(filename?)` — Run `pg_dump --format=custom`, save to local
  `backups/` directory, upload to S3 (best-effort). Returns backup metadata.
- `listBackups()` — Merge local and S3 listings, deduplicate by filename.
  Returns array of `{ filename, size, createdAt, location: 'local'|'s3'|'both' }`.
- `restoreBackup(filename)` — Run `pg_restore` from local file. If file
  only exists in S3, download it first. Drops and recreates tables.
- `deleteBackup(filename)` — Delete locally and from S3. Refuse to delete
  scheduled backups (daily-*, weekly-*) to prevent accidental data loss.

**Backup naming convention:**

- Adhoc: `adhoc-{seq}-{YYYYMMDD}-{env}-v{version}.dump`
- Daily: `daily-{seq}-{YYYYMMDD}-{env}-v{version}.dump`
- Weekly: `weekly-{seq}-{YYYYMMDD}-{env}-v{version}.dump`

Sequential numbering increments globally and persists across days.

**pg_dump fallback for macOS dev:**

On macOS, `pg_dump` may not be installed natively. The inventory app
detects this and falls back to running `pg_dump` inside a Docker container:

```typescript
async function pgDumpViaDocker(databaseUrl: string, outputPath: string) {
  // Rewrite localhost to host.docker.internal for container access
  const containerUrl = databaseUrl.replace('localhost', 'host.docker.internal');
  const cmd = `docker run --rm -v "${path.dirname(outputPath)}:/backups" ` +
    `postgres:16-alpine pg_dump "${containerUrl}" --format=custom ` +
    `-f /backups/${path.basename(outputPath)}`;
  await execAsync(cmd);
}
```

### 2. BackupRotationService

Manages retention policy. Registered as scheduled jobs:

- `daily-backup` — runs every 24 hours, keeps last 7 daily backups
- `weekly-backup` — runs every 7 days, keeps last 4 weekly backups

### 3. S3 Storage

Use the AWS SDK (`@aws-sdk/client-s3`) configured for DigitalOcean Spaces
or any S3-compatible provider:

```typescript
const s3 = new S3Client({
  endpoint: `https://${process.env.DO_SPACES_REGION}.digitaloceanspaces.com`,
  region: process.env.DO_SPACES_REGION,
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY,
    secretAccessKey: process.env.DO_SPACES_SECRET,
  },
});
```

S3 upload is best-effort — if it fails (credentials not configured, network
error), the backup still succeeds locally with a warning logged.

### 4. Admin Routes

- `POST /api/admin/backup/create` — create adhoc backup (admin only)
- `GET /api/admin/backup/list` — list all backups with metadata
- `POST /api/admin/backup/restore` — restore from a named backup (admin only)
- `DELETE /api/admin/backup/:filename` — delete a backup (admin only,
  refuses scheduled backups)

### 5. Admin UI

Add a Backup panel to the admin dashboard:

- "Create Backup" button
- Table of backups: filename, size, date, location (local/S3/both)
- Restore button per backup (with confirmation dialog)
- Delete button (disabled for scheduled backups)

## Dockerfile Changes

The production Dockerfile must include `postgresql16-client` so pg_dump
and pg_restore are available at runtime:

```dockerfile
# In the final stage:
RUN apk add --no-cache postgresql16-client
```

## Environment Variables

```
BACKUP_PATH=backups               # local backup directory
DO_SPACES_KEY=                     # optional, for S3 upload
DO_SPACES_SECRET=
DO_SPACES_REGION=sfo3
DO_SPACES_BUCKET=your-app-backups
```

## Reference Files

- Inventory: `server/src/services/backup.service.ts`
- Inventory: `docker/Dockerfile.server` (postgresql16-client install)

## Verification

- `POST /api/admin/backup/create` produces a `.dump` file in `backups/`
- `GET /api/admin/backup/list` shows the backup with correct metadata
- `POST /api/admin/backup/restore` restores database to backup state
- S3 upload works when credentials are configured, degrades gracefully
  when not
- Docker fallback works on macOS when pg_dump is not installed locally
- Daily and weekly scheduled backups run and rotate correctly
