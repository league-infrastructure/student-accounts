---
id: '005'
title: Build environment info endpoint and admin page
status: done
use-cases:
- SUC-003
depends-on:
- '003'
---

# Build environment info endpoint and admin page

## Description

Create the environment info endpoint and admin page. This is the default
landing page after admin login, showing server runtime information at a
glance.

## Tasks

1. Create `server/src/routes/admin/env.ts`:
   - `GET /api/admin/env` returns:
     ```json
     {
       "node": "v20.x.x",
       "uptime": 12345,
       "memory": { "rss": 52428800, "heapUsed": 28311552, "heapTotal": 40894464 },
       "deployment": "dev",
       "database": "connected",
       "integrations": {
         "github": { "configured": true },
         "google": { "configured": false },
         "pike13": { "configured": true },
         "githubToken": { "configured": false },
         "anthropic": { "configured": false },
         "openai": { "configured": false }
       }
     }
     ```
   - Database status via `prisma.$queryRaw\`SELECT 1\`` in try/catch
   - Integration status: reuse logic from existing integrations.ts, plus
     check new keys (GITHUB_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY)
     via the config service

2. Mount in admin router.

3. Replace placeholder `client/src/pages/admin/EnvironmentInfo.tsx`:
   - Card-based layout showing each category
   - Uptime as human-readable ("2h 15m 30s")
   - Memory in MB
   - Integration status as green/red indicators

## Acceptance Criteria

- [ ] GET `/api/admin/env` returns all fields listed above
- [ ] Database status reports "connected" or "disconnected"
- [ ] Integration status reflects current env vars and config
- [ ] Frontend displays all info in a clean card layout
- [ ] Endpoint requires admin session (401 without)

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/admin-env.test.ts`: response shape, database status check,
    requires admin auth
- **Verification command**: `npm run test:server`
