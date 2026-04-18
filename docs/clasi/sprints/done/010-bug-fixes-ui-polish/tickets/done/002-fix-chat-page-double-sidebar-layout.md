---
id: '002'
title: Fix Chat page double-sidebar layout
status: done
use-cases: []
depends-on:
- '001'
---

# Fix Chat page double-sidebar layout

## Description

The Chat page renders its own 240px dark sidebar (channel list) inside
AppLayout's content area, which already has a sidebar. This creates a
double-sidebar "chat-ception" effect.

Fix by removing Chat's own sidebar/container wrapper and instead rendering
the channel list and message area in a way that works within AppLayout's
content region. The channel list can be a narrower panel within the content
area without duplicating the full-height dark sidebar look.

## Acceptance Criteria

- [ ] Chat page has only one sidebar (the AppLayout nav sidebar)
- [ ] Channel list is visible within the chat content area
- [ ] Messages display correctly with no layout overflow
- [ ] Send message still works

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: None beyond existing Chat.test.tsx updates
- **Verification command**: `npm run test:client`
