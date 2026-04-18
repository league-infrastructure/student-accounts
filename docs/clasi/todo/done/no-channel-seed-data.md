---
title: "No seed data for channels \u2014 chat is empty on fresh install"
priority: medium
status: done
sprint: '010'
tickets:
- '004'
---

## Problem

There is no database seed script. On a fresh install, the channels table
is empty, so even if auth works correctly, the Chat page shows an empty
channel list with "No messages yet."

A user would need to go to the admin panel to create channels before
chat is usable, but there's no indication of this in the UI.

## Expected Behavior

Either:
- Add a Prisma seed script that creates a default "general" channel
- Auto-create a "general" channel on first server boot
- Show a helpful message when no channels exist ("Ask an admin to create
  a channel" or, for admins, a link to the channel management page)

## Files

- `server/prisma/` — no seed file exists
- `client/src/pages/Chat.tsx` — tries to auto-select "general" channel
