---
id: 008
title: Build single-file example integration page
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
depends-on:
- '003'
- '004'
- '005'
- '006'
- '007'
---

# Build single-file example integration page

## Description

Create a single React component file that demonstrates all three
integrations. This file is DISPOSABLE — deleting it and reverting
App.tsx removes the entire example with no side effects.

## Changes

1. **`client/src/pages/ExampleIntegrations.tsx`** (new, disposable):
   - On mount: fetch `/api/integrations/status` and `/api/auth/me`
   - **Counter section**: inline counter increment/decrement
   - **GitHub card**: if configured, "Connect GitHub" button → after
     login shows profile + repo list. If not configured, muted card
     with "Not configured — see docs/api-integrations.md"
   - **Google card**: same pattern — login button or "not configured"
   - **Pike 13 card**: "Show Events" button → fetches and displays table.
     Or "not configured" card.
   - All fetch calls inline — no service wrappers, no shared state
   - Only imports: `react`

2. **`client/src/App.tsx`** — replace current counter demo with:
   ```tsx
   import ExampleIntegrations from './pages/ExampleIntegrations'
   function App() { return <ExampleIntegrations /> }
   ```

## Design Rules

- ONE file: `ExampleIntegrations.tsx`
- NO shared components, contexts, or state stores
- NO React Router (single page)
- Plain `fetch()` for all API calls
- Deleting this file + reverting App.tsx = clean build

## Acceptance Criteria

- [ ] Page loads and shows counter + 3 integration cards
- [ ] With no API keys: 3 "not configured" cards with doc links
- [ ] With GitHub configured: OAuth login works, profile + repos display
- [ ] With Google configured: OAuth login works, profile displays
- [ ] With Pike 13 configured: events table displays
- [ ] `npm run build` succeeds
- [ ] Deleting `ExampleIntegrations.tsx` + reverting `App.tsx` → clean build

## Testing

- **Existing tests to run**: `npm run build`
- **New tests to write**: None (the page IS the integration test)
- **Verification command**: `npm run build && npm run dev`
