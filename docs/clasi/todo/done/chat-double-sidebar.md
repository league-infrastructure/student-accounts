---
title: Chat page has double sidebar (chat-ception)
priority: high
status: done
sprint: '010'
tickets:
- '002'
---

## Problem

When navigating to `/chat`, the Chat page renders its own channel sidebar
(dark, 240px wide) inside the AppLayout's content area, which already has its
own sidebar. This creates a "double sidebar" effect — the app's nav sidebar on
the left, then the chat's channel sidebar immediately next to it.

The Chat component defines its own `container` style with
`height: calc(100vh - 64px)` and a `sidebar` with `width: 240`, creating a
layout-within-a-layout.

## Expected Behavior

The Chat page should integrate with the existing AppLayout rather than
creating a second full-height sidebar. Options:
- Use the AppLayout sidebar to show channels (replace nav items contextually)
- Remove the Chat component's own sidebar and use a different channel picker
- Make Chat a full-page layout that replaces AppLayout (like AdminLayout does)

## Files

- `client/src/pages/Chat.tsx` — defines its own sidebar + main layout
- `client/src/components/AppLayout.tsx` — the wrapping layout with sidebar
- `client/src/App.tsx` — routes Chat inside AppLayout
