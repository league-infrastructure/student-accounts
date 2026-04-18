---
id: '004'
title: Create chat API routes
status: todo
use-cases:
- SUC-002
- SUC-004
- SUC-005
depends-on:
- '003'
---

# Create chat API routes

## Description

Create the Express route handlers for channel CRUD, message CRUD, and
global search. All routes require authentication; channel create/delete
require admin role.

### Changes

1. **`server/src/routes/channels.ts`**:
   - `GET /api/channels` — List all channels with message counts. Requires
     auth.
   - `POST /api/channels` — Create a new channel (name, description).
     Requires admin. Returns 409 on duplicate name.
   - `GET /api/channels/:id` — Get channel with paginated messages. Accepts
     `?limit=50&before=123` query params. Requires auth.
   - `DELETE /api/channels/:id` — Delete channel and cascade-delete
     messages. Requires admin.
   - `POST /api/channels/:id/messages` — Post a message to a channel.
     Requires auth. Validates non-empty content.

2. **`server/src/routes/messages.ts`**:
   - `DELETE /api/messages/:id` — Delete a message. Requires auth. Only
     the message author or an admin can delete.

3. **`server/src/routes/search.ts`**:
   - `GET /api/search?q=...` — Search across channels (name, description)
     and messages (content). Requires auth. Minimum query length of 2
     characters. Returns results grouped by type, limited to 5 per type.
     Uses Prisma `contains` (case-insensitive).

4. **Mount routes** in `server/src/app.ts`

## Acceptance Criteria

- [ ] `GET /api/channels` returns list of channels with message counts
- [ ] `POST /api/channels` creates a channel (admin only, 403 for non-admin)
- [ ] `POST /api/channels` returns 409 for duplicate channel name
- [ ] `GET /api/channels/:id` returns channel with paginated messages
- [ ] `GET /api/channels/:id` supports `limit` and `before` query params
- [ ] `DELETE /api/channels/:id` deletes channel and messages (admin only)
- [ ] `POST /api/channels/:id/messages` posts a message (auth required)
- [ ] `POST /api/channels/:id/messages` rejects empty content
- [ ] `DELETE /api/messages/:id` deletes message (author or admin only)
- [ ] `GET /api/search?q=...` returns grouped results (channels, messages)
- [ ] `GET /api/search` requires minimum 2-character query
- [ ] All routes return 401 for unauthenticated requests
- [ ] Routes are mounted in `server/src/app.ts`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:server`
