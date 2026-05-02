---
id: '003'
title: "Server + Client \u2014 drop compat redirects"
status: done
use-cases:
- SUC-023-006
depends-on: []
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server + Client — drop compat redirects

## Description

Sprint 020 shipped two temporary shims to preserve backward compatibility
with callers that used the old `/api/admin/oauth-clients` path:

1. **Server**: `oauthClientsCompatRouter` — a Router exported from
   `server/src/routes/oauth-clients.ts` and mounted in `app.ts` that
   308-redirects `/api/admin/oauth-clients/*` to `/api/oauth-clients/*`.

2. **Client**: A `<Route path="/admin/oauth-clients" element={<Navigate to="/oauth-clients" replace />} />`
   in `client/src/App.tsx` (line 85).

Both were marked "drop in a follow-up release." This is that release. No
callers are known to depend on these paths (confirmed by searching code,
docs, and MCP setup guide).

## Acceptance Criteria

- [x] `oauthClientsCompatRouter` is deleted from `server/src/routes/oauth-clients.ts` — the two `oauthClientsCompatRouter.all` route definitions and the `export const oauthClientsCompatRouter` declaration are removed.
- [x] The `import { oauthClientsRouter, oauthClientsCompatRouter }` in `server/src/app.ts` is updated to import only `oauthClientsRouter`; the `app.use('/api', oauthClientsCompatRouter)` line is removed.
- [x] The `<Route path="/admin/oauth-clients" element={<Navigate to="/oauth-clients" replace />} />` line is deleted from `client/src/App.tsx`.
- [x] `GET /api/admin/oauth-clients` on a running server returns 404 (not a 308 redirect).
- [x] `GET /admin/oauth-clients` in the browser renders the NotFound page (not a redirect to `/oauth-clients`).
- [x] Any existing redirect tests in `tests/server/routes/oauth-clients.test.ts` are deleted.
- [x] A new test asserts that `GET /api/admin/oauth-clients` returns 404.
- [x] TypeScript compilation passes (`npm run build` or `tsc --noEmit`).

## Implementation Plan

### Approach

Pure deletion — no new logic. The changes are in three files and are
independent of tickets 001 and 002 (no shared code paths). Can execute in
parallel with those tickets.

### Files to Modify

- `server/src/routes/oauth-clients.ts`:
  - Delete lines 31-51 (the two `oauthClientsCompatRouter.all` definitions).
  - Delete `export const oauthClientsCompatRouter = Router();` (line 31 area).

- `server/src/app.ts`:
  - Change import line from `import { oauthClientsRouter, oauthClientsCompatRouter }` to `import { oauthClientsRouter }`.
  - Delete `app.use('/api', oauthClientsCompatRouter)` (line 86 area).
  - Delete the comment block above it that references the compat redirect ("Compat redirect: /api/admin/oauth-clients → /api/oauth-clients").

- `client/src/App.tsx`:
  - Delete line 85: `<Route path="/admin/oauth-clients" element={<Navigate to="/oauth-clients" replace />} />`.
  - If `Navigate` is no longer used elsewhere in the file, remove it from the `react-router-dom` import.

### Testing Plan

In `tests/server/routes/oauth-clients.test.ts`:
- Delete any test block asserting 308 redirect behavior for `/api/admin/oauth-clients`.
- Add: `it('returns 404 for deprecated admin path', async () => { const res = await request(app).get('/api/admin/oauth-clients'); expect(res.status).toBe(404); });`

Run `npm run test:server` to confirm no regressions.

### Documentation Updates

None — the sprint architecture and use case docs already describe the removal.
