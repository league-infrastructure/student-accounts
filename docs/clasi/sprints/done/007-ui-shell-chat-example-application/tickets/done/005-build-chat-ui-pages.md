---
id: '005'
title: Build chat UI pages
status: done
use-cases:
- SUC-002
- SUC-003
depends-on:
- '002'
- '004'
---

# Build chat UI pages

## Description

Build the Chat and Channels (admin) React pages. The Chat page provides
the main messaging interface with channel selection, message feed, and
input. The Channels page provides admin-only channel management.

### Changes

1. **`client/src/pages/Chat.tsx`**:
   - Channel list sidebar within the content area (left side)
   - Channels display name and message count
   - Selecting a channel loads its messages via `GET /api/channels/:id`
   - Default selection: first channel or `#general`
   - Message feed displays messages with author name, avatar (or
     placeholder), and timestamp
   - Messages ordered chronologically (oldest to newest)
   - Auto-scroll to bottom when new messages arrive (if user is already
     at the bottom)
   - Message input at the bottom with Enter-to-send and Send button
   - Input clears after successful send
   - Empty messages are not sent (client-side validation)
   - Polling every 3 seconds via `setInterval` to fetch new messages
   - No duplicate messages in the feed from polling

2. **`client/src/pages/Channels.tsx`** (admin):
   - List all channels with name, description, message count, created date
   - Create channel form: name input, optional description, Create button
   - Validation: non-empty name, shows error on duplicate name (409)
   - Delete button per channel with confirmation dialog
   - Only accessible to admin users

## Acceptance Criteria

- [x] Chat page renders channel list sidebar and message feed area
- [x] Selecting a channel loads and displays its messages
- [x] Default channel is `#general` (or first available)
- [x] Messages display author name, avatar placeholder, and timestamp
- [x] Message input visible at bottom; Enter or Send button posts message
- [x] Input clears after successful send
- [x] Empty messages are not sent
- [x] Polling fetches new messages every ~3 seconds without duplicates
- [x] Auto-scroll to bottom on new messages when already at bottom
- [x] Channels admin page lists all channels with details
- [x] Admin can create a new channel via form
- [x] Duplicate channel name shows error message
- [x] Admin can delete a channel with confirmation dialog
- [x] Channels page restricted to admin users

## Testing

- **Existing tests to run**: `npm run test:client` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:client`
