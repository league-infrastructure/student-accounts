---
id: '008'
title: Write chat and UI tests
status: done
use-cases:
- SUC-002
- SUC-003
- SUC-004
- SUC-005
depends-on:
- '004'
- '005'
- '006'
---

# Write chat and UI tests

## Description

Write comprehensive server and client tests for all chat functionality
and UI components added in this sprint. Server tests use Supertest with
`POST /api/auth/test-login` for authentication. Client tests use Vitest
and React Testing Library.

### Changes

1. **Server tests** (`tests/server/`):
   - **Channel CRUD tests**:
     - `GET /api/channels` returns channel list with message counts
     - `POST /api/channels` creates channel (admin), returns 403 for
       non-admin, returns 409 for duplicate name
     - `GET /api/channels/:id` returns channel with messages, supports
       `limit` and `before` pagination params
     - `DELETE /api/channels/:id` deletes channel and cascades messages
       (admin), returns 403 for non-admin
   - **Message tests**:
     - `POST /api/channels/:id/messages` creates message (authenticated),
       returns 401 for unauthenticated, rejects empty content
     - `DELETE /api/messages/:id` allows author or admin, returns 403 for
       other users
     - Message pagination: messages returned in correct order, `before`
       cursor works correctly
   - **Auth guard tests**:
     - All chat routes return 401 when unauthenticated
     - Admin-only routes return 403 for non-admin users
   - **Search endpoint tests**:
     - `GET /api/search?q=...` returns grouped results (channels, messages)
     - Returns empty results for no matches
     - Respects minimum 2-character query length
     - Results limited to 5 per type

2. **Client tests** (`tests/client/`):
   - **AppLayout tests**:
     - Renders sidebar with correct navigation items
     - Admin nav items hidden for non-admin users
     - Admin nav items visible for admin users
     - User dropdown displays name and role
     - Mobile hamburger toggle shows/hides sidebar
   - **Chat page tests**:
     - Renders channel list and message feed
     - Message input submits and clears
   - **Channels admin tests**:
     - Channel creation form works
     - Channel deletion with confirmation
   - **Admin panel tests** (from Sprint 006 — client tests deferred here):
     - `UsersPanel`: renders user list, create/edit/delete flows work
     - `ScheduledJobsPanel`: renders job list, toggle enable/disable works
     - `ImportExport`: renders backup list, create/download works
     - `PermissionsPanel`: renders pattern list, create/edit/delete flows
     - `EnvironmentPanel`: displays integration config status
     - `SessionPanel`: displays linked user info, refresh button works

3. All server tests use `request.agent(app)` with
   `POST /api/auth/test-login` for session auth. Never mock session
   middleware or fabricate cookies.

## Acceptance Criteria

- [x] Channel CRUD server tests: list, create (admin/non-admin), get
      with messages, delete (admin/non-admin)
- [x] Message server tests: create, delete (author/admin/other), pagination
- [x] Auth guard tests: 401 unauthenticated, 403 non-admin on admin routes
- [x] Search endpoint tests: grouped results, empty results, min query
      length, result limits
- [x] AppLayout client tests: sidebar nav, admin visibility, user dropdown,
      mobile hamburger
- [x] Chat page client tests: channel list, message feed, input
- [x] Channels admin client tests: create form, delete confirmation
- [ ] Admin panel client tests: UsersPanel, ScheduledJobsPanel,
      ImportExport, PermissionsPanel, EnvironmentPanel, SessionPanel
- [x] All tests use `POST /api/auth/test-login` (no mocked sessions)
- [x] `npm run test:server` passes
- [x] `npm run test:client` passes

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: This ticket IS the test ticket
- **Verification command**: `npm run test:server && npm run test:client`
