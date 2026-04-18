---
title: Page title shows 'client-tmp' instead of app name
priority: low
status: done
sprint: '010'
tickets:
- '004'
---

## Problem

The browser tab title shows "client-tmp" on every page. This comes from
`client/index.html` line 7:

```html
<title>client-tmp</title>
```

## Expected Behavior

Title should be "College App Navigator" or similar, and ideally update
per-page (e.g., "Chat — College App Navigator").

## Files

- `client/index.html` — hardcoded title
