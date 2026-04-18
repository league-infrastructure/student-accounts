---
title: Search bar in topbar does nothing
priority: medium
status: done
sprint: '010'
tickets:
- '004'
---

## Problem

The search input in the AppLayout topbar accepts text but has no
`onChange` handler, no submit behavior, and no connection to the
`/api/search` endpoint that exists on the backend.

## Expected Behavior

Either:
- Wire the search bar to the `/api/search` endpoint and display results
- Remove the search bar if search isn't a v1 feature
- Add placeholder text indicating it's coming soon and disable it

## Files

- `client/src/components/AppLayout.tsx` — search input at line 341
- `server/src/routes/search.ts` — backend search endpoint exists
