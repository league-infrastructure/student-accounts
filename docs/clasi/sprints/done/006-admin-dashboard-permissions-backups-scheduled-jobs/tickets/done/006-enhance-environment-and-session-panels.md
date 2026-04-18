---
id: '006'
title: Enhance environment and session panels
status: todo
use-cases:
- SUC-005
depends-on: []
---

# Enhance environment, session, configuration, and log panels; add SessionService

## Description

Enhance four existing admin panels and create a `SessionService` to wrap
session queries in the ServiceRegistry pattern. Also verify that existing
integrations (GitHub OAuth, Google OAuth, Pike 13) still work after the
auth system changes from Sprint 005.

### Changes

1. **`server/src/services/session.service.ts`** (new):
   - Create `SessionService` with methods: `list()` (returns sessions with
     linked user info and expiry), `count()`, `deleteExpired()`.
   - Register in the `ServiceRegistry`.
   - Session routes should delegate to this service instead of raw Prisma
     queries.

2. **`server/src/routes/admin/environment.ts`** (or equivalent existing route):
   - Add an `integrations` field to the environment API response. For each
     integration, report whether the required environment variables are set
     (boolean, without revealing actual values):
     - GitHub OAuth: `GITHUB_CLIENT_ID` configured? true/false
     - Google OAuth: `GOOGLE_CLIENT_ID` configured? true/false
     - Pike 13: `PIKE13_ACCESS_TOKEN` configured? true/false
     - MCP: `MCP_DEFAULT_TOKEN` configured? true/false

3. **`client/src/components/admin/EnvironmentPanel.tsx`** — Enhancement:
   - Add an "Integrations" section below the existing environment info.
   - Display each integration as a row with name and status (configured /
     not configured) using visual indicators (green check / red X or similar).

4. **`server/src/routes/admin/sessions.ts`** (or equivalent existing route):
   - Delegate to `SessionService.list()` instead of raw session queries.
   - Response includes linked user info (email, display name, role) and
     session expiry timestamp.

5. **`client/src/components/admin/SessionPanel.tsx`** — Enhancement:
   - Display user email, display name, and role instead of raw session JSON.
   - Show session creation time and expiry time.
   - Highlight sessions expiring within 1 hour (visual warning style).
   - Add a manual "Refresh" button.

6. **Configuration Panel verification** — Verify the existing Configuration
   panel:
   - Grouped config keys with metadata display correctly
   - Secret values are masked in the UI
   - `.env` export functionality works
   - "Requires restart" indicators are present where applicable

7. **Log Viewer verification** — Verify the existing Log Viewer:
   - Log level filtering works (All, Info+, Warn+, Error+)
   - Log levels are color-coded
   - Timestamp and request details display correctly

8. **Integration verification** — Verify that existing OAuth integrations
   still function after Sprint 005 auth changes:
   - GitHub OAuth callback URL is still correct
   - Google OAuth callback URL is still correct
   - Pike 13 integration config is preserved
   - Integration status endpoint correctly reports which are configured

## Acceptance Criteria

- [ ] `SessionService` created with `list()`, `count()`, `deleteExpired()`
- [ ] `SessionService` registered in ServiceRegistry
- [ ] Session routes delegate to `SessionService` (no raw Prisma queries)
- [ ] Environment API response includes `integrations` object with boolean
      status for each integration
- [ ] `EnvironmentPanel` displays integration config status with visual indicators
- [ ] Integration status does not reveal actual secret values
- [ ] Sessions API response includes linked user info (email, name, role)
- [ ] Sessions API response includes session expiry timestamp
- [ ] `SessionPanel` displays user info instead of raw session data
- [ ] Sessions expiring within 1 hour are visually highlighted
- [ ] `SessionPanel` has a manual refresh button
- [ ] Configuration panel: grouped keys display, secret masking works,
      `.env` export works
- [ ] Log Viewer: level filtering, color coding, timestamps all work
- [ ] GitHub/Google OAuth callback URLs are correct after auth changes
- [ ] Integration status endpoint reports configured integrations accurately
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Manual verification**: Log in via each OAuth provider (if credentials
  available), verify admin panels load and display correctly
- **Verification command**: `cd server && npx tsc --noEmit`
