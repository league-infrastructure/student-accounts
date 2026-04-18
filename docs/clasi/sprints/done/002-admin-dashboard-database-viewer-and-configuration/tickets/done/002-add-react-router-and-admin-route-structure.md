---
id: '002'
title: Add React Router and admin route structure
status: done
use-cases: []
depends-on: []
---

# Add React Router and admin route structure

## Description

Install `react-router-dom` and set up the routing structure that separates
the demo app (`/`) from the admin area (`/admin/*`). Create the AdminLayout
component with sidebar navigation and an Outlet for child routes. Wire up
placeholder pages for each admin section so subsequent tickets can replace
them one at a time.

## Tasks

1. Install `react-router-dom` in the client package.

2. Update `client/src/App.tsx` to use BrowserRouter and Routes:
   - `/` renders ExampleIntegrations (existing demo)
   - `/admin` renders AdminLogin (placeholder)
   - `/admin/*` renders AdminLayout wrapping child routes

3. Create `client/src/pages/admin/AdminLayout.tsx`:
   - Simple sidebar with nav links: Environment, Database, Configuration,
     Logs, Sessions
   - Logout button in sidebar footer
   - `<Outlet />` for rendering child routes
   - On mount, check admin auth status (GET `/api/admin/check`); redirect
     to `/admin` login if not authenticated

4. Create placeholder components for each admin page (heading + "Coming
   soon" text): EnvironmentInfo, DatabaseViewer, ConfigPanel, LogViewer,
   SessionViewer.

5. Create placeholder AdminLogin component (just the UI; auth logic comes
   in ticket #003).

## Acceptance Criteria

- [ ] `react-router-dom` is in client/package.json
- [ ] Navigating to `/` shows the demo app
- [ ] Navigating to `/admin` shows a login placeholder
- [ ] Navigating to `/admin/env` shows the admin layout with sidebar
- [ ] Sidebar has links for all 5 sections
- [ ] Active link is visually highlighted
- [ ] Browser back/forward navigation works
- [ ] Page refresh on any route works (Vite SPA fallback)

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: AdminLayout renders sidebar links and Outlet
- **Verification command**: `npm run test:client`
