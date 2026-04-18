---
id: '006'
title: Create Home, About pages and update routing
status: done
use-cases:
- SUC-001
- SUC-007
depends-on:
- '002'
---

# Create Home, About pages and update routing

## Description

Create the Home and About pages, update `App.tsx` to wrap all routes in
the AppLayout component, configure sidebar navigation, and remove the old
`ExampleIntegrations.tsx` page.

### Changes

1. **`client/src/pages/Home.tsx`**:
   - Dashboard/landing page for authenticated users
   - Welcome message or overview content appropriate for the template

2. **`client/src/pages/About.tsx`**:
   - Display application name
   - Display current application version (from package.json or environment
     variable)
   - Basic information about the template

3. **`client/src/App.tsx`**:
   - Wrap authenticated routes in `<AppLayout>` using React Router nested
     routes with `<Outlet />`
   - Configure routes:
     - `/` — Home
     - `/chat` — Chat
     - `/admin/channels` — Channels (admin)
     - `/admin/*` — Admin sub-routes from Sprint 006
     - `/mcp-setup` — MCP Setup (placeholder or existing)
     - `/about` — About
   - Set up sidebar navigation items matching the route structure:
     - Home, Chat, Admin (with sub-items), MCP Setup, About

4. **Remove `client/src/pages/ExampleIntegrations.tsx`**: Delete the file
   and remove its route from App.tsx

5. **Default user display**: When no real auth session exists, display
   "Eric Busboom" / "student" as the default placeholder in the user
   dropdown

## Acceptance Criteria

- [x] `Home.tsx` renders a landing/dashboard page
- [x] `About.tsx` displays application name and version
- [x] `App.tsx` wraps routes in `AppLayout` with nested routing
- [x] All routes are correctly configured and navigable
- [x] Sidebar navigation matches: Home, Chat, Admin (admin-only with
      sub-items), MCP Setup, About
- [x] `ExampleIntegrations.tsx` is deleted and its route removed
- [x] Default user display shows "Eric Busboom" / "student" when no
      session exists
- [x] `npm run dev` starts and displays the full AppLayout shell

## Testing

- **Existing tests to run**: `npm run test:client` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:client`
