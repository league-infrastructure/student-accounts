---
id: '002'
title: Build AppLayout component
status: todo
use-cases:
- SUC-001
- SUC-005
- SUC-006
depends-on:
- '001'
---

# Build AppLayout component

## Description

Build the application shell layout component that wraps all authenticated
routes. This provides the sidebar navigation, top bar with search and user
dropdown, and content area for child routes.

### Changes

1. **`client/src/components/AppLayout.tsx`**:
   - **Sidebar**:
     - Top: Logo/flag icon + application name
     - Middle: Navigation items (Home, Chat, Admin group with sub-items)
     - Bottom: MCP Setup, About
     - Admin section visible only when `hasAdminAccess(user.role)` is true
     - Admin sub-items: Users, Environment, Configuration, Database, Logs,
       Sessions, Permissions, Backups, Scheduled Jobs, Integrations
     - Active nav item visually highlighted
   - **Top bar**:
     - Left: Hamburger toggle (mobile only)
     - Center: Search input with 300ms debounce (minimum 2 characters),
       results dropdown grouped by type (Channels, Messages)
     - Right: User display (name + role) with dropdown menu containing
       Account and Logout
   - **Content area**: Renders child routes via `<Outlet />`
   - **Mobile responsive**: Sidebar hidden by default on mobile, toggled
     via hamburger icon

2. **Integrate with AuthContext**: Use `useAuth()` for user display and
   logout action. Use `hasAdminAccess()` from roles library for admin
   nav visibility.

## Acceptance Criteria

- [ ] `client/src/components/AppLayout.tsx` renders sidebar, top bar, and
      content area
- [ ] Sidebar displays logo/icon and application name at the top
- [ ] Home and Chat links visible to all authenticated users
- [ ] Admin section with sub-items (Users, Environment, Configuration,
      Database, Logs, Sessions, Permissions, Backups, Scheduled Jobs,
      Integrations) visible only to admin users
- [ ] MCP Setup and About links appear at the bottom of the sidebar
- [ ] Active navigation item is visually highlighted
- [ ] Search input in top bar with 300ms debounce, minimum 2 characters
- [ ] Search results dropdown grouped by type (Channels, Messages)
- [ ] User dropdown displays name and role (default: "Eric Busboom" / "student")
- [ ] User dropdown contains Account and Logout options
- [ ] Clicking Logout calls `logout()` from AuthContext
- [ ] Dropdown closes when clicking outside
- [ ] On mobile, sidebar hidden by default and toggled via hamburger icon
- [ ] Content area renders child routes

## Testing

- **Existing tests to run**: `npm run test:client` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:client`
