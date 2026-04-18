---
id: '007'
title: Build configuration panel with export
status: in-progress
use-cases:
- SUC-006
- SUC-007
- SUC-008
- SUC-011
depends-on:
- '003'
- '004'
---

# Build configuration panel with export

## Description

Build the admin configuration panel: API endpoints for reading, updating,
and exporting config values, plus the frontend form UI. This is the main
tool for managing API credentials at runtime.

## Tasks

1. Create `server/src/routes/admin/config.ts`:

   - `GET /api/admin/config` — calls `getAllConfig()` from the config
     service, returns all keys with masked values, sources, and metadata.

   - `PUT /api/admin/config` — accepts `{ key, value }`, validates key,
     calls `setConfig()`. Returns:
     ```json
     {
       "success": true,
       "warning": "Environment variable overrides this value",
       "restart": true
     }
     ```
     `warning` only present if env var exists for the key.
     `restart` only present if key has `requiresRestart: true`.

   - `GET /api/admin/config/export` — calls `exportConfig()`, returns as
     `text/plain` with `Content-Disposition: attachment; filename=config-export.env`.

2. Mount in admin router.

3. Replace placeholder `client/src/pages/admin/ConfigPanel.tsx`:
   - Group credentials by category (GitHub OAuth, Google OAuth, Pike 13,
     GitHub API, AI Services)
   - Each row: label, masked value, source badge (env/database/not set)
   - "Restart required" badge on OAuth credential rows
   - Edit button reveals an input field; Save button submits via PUT
   - Warning banner when env var overrides a database value
   - Export button at top triggers download of config-export.env
   - Success/error toast on save

## Acceptance Criteria

- [ ] GET `/api/admin/config` returns all 11 keys with masked values and sources
- [ ] PUT `/api/admin/config` with valid key saves and refreshes cache
- [ ] PUT `/api/admin/config` with unknown key returns 400
- [ ] PUT response includes `warning` when env var override exists
- [ ] PUT response includes `restart: true` for OAuth keys
- [ ] GET `/api/admin/config/export` returns downloadable .env file
- [ ] Export contains only database-stored values (not env var values)
- [ ] Frontend displays grouped credentials with correct badges
- [ ] Inline editing and saving works
- [ ] Endpoints require admin session

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/admin-config.test.ts`: GET returns all keys, PUT saves
    and returns warnings, export format, unknown key rejection, auth required
- **Verification command**: `npm run test:server`
