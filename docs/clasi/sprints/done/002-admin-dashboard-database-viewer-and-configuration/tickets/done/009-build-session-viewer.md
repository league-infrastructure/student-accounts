---
id: 009
title: Build session viewer
status: in-progress
use-cases:
- SUC-010
depends-on:
- '003'
---

# Build session viewer

## Description

Build the admin session viewer: an endpoint that queries the session table
and a frontend page that displays active sessions. Read-only — no session
invalidation in this sprint.

## Tasks

1. Create `server/src/routes/admin/sessions.ts`:
   - `GET /api/admin/sessions` — queries the `session` table:
     ```sql
     SELECT sid, sess, expire
     FROM session
     WHERE expire > NOW()
     ORDER BY expire DESC
     ```
   - Parse `sess` JSONB to extract:
     - Whether `isAdmin` is set
     - Whether an OAuth user is attached (and which provider)
     - Cookie expiry
   - Truncate `sid` to first 8 characters
   - Return `[{ sid, expire, isAdmin, hasUser, provider }]`

2. Mount in admin router.

3. Replace placeholder `client/src/pages/admin/SessionViewer.tsx`:
   - Table showing: truncated session ID, admin status (badge), user/provider
     info, expiry time
   - Visual indicator for sessions expiring within the next hour
   - "No active sessions" message when table is empty
   - Refresh button

## Acceptance Criteria

- [ ] GET `/api/admin/sessions` returns active (non-expired) sessions
- [ ] Session IDs are truncated to 8 characters
- [ ] Response includes isAdmin flag and OAuth provider info from sess JSONB
- [ ] Expired sessions are excluded
- [ ] Frontend displays sessions in a clear table
- [ ] Sessions expiring soon are visually highlighted
- [ ] Endpoint requires admin session

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/admin-sessions.test.ts`: returns active sessions,
    excludes expired, parses sess JSONB, auth required
- **Verification command**: `npm run test:server`
