---
title: "No 404 page \u2014 unmatched routes show blank screen"
priority: medium
status: done
sprint: '010'
tickets:
- '003'
---

## Problem

Navigating to any undefined route (e.g., `/profile`, `/plan`, `/account`,
or any typo) renders a completely blank page with no navigation, no error
message, and no way back. The React Router config has no catch-all route.

## Expected Behavior

Add a catch-all `*` route that renders a 404 page with:
- A "Page not found" message
- A link back to Home
- The AppLayout wrapper so navigation is still available

## Files

- `client/src/App.tsx` — route definitions, no `*` catch-all
