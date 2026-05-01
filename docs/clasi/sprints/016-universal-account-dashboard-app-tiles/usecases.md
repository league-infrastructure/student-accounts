---
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 016 Use Cases

---

## SUC-016-001: User views personal dashboard with app tiles
Parent: UC-019

- **Actor**: Any authenticated user (student, staff, or admin)
- **Preconditions**:
  - User has completed login via Google, GitHub, or Pike13 OAuth.
  - Session is established and `approval_status = 'approved'`.
- **Main Flow**:
  1. After login, the OAuth callback redirects to `/account` regardless of role.
  2. `Account.tsx` loads; it calls `GET /api/account/apps` via React Query.
  3. The server computes the tile list from the user's role and entitlements.
  4. The page renders the existing Profile/Identity content plus an Apps zone
     containing role-appropriate `AppTile` components.
  5. Each tile displays a title, short description, and icon. Clicking a tile
     navigates to the target sub-app URL.
- **Postconditions**: User sees their dashboard with appropriate tiles. No
  session, role, or data mutation occurs.
- **Acceptance Criteria**:
  - [ ] Visiting `/account` while authenticated never redirects away (no admin
        `<Navigate to="/" />` redirect).
  - [ ] `GET /api/account/apps` returns 200 with an array of tile objects for
        any authenticated role.
  - [ ] `GET /api/account/apps` returns 401 for unauthenticated callers.
  - [ ] Tile shape: `{ id, title, description, href, icon }` — all fields
        present and non-empty.
  - [ ] Student (no LLM token) receives no LLM Proxy tile.
  - [ ] Student with active LLM proxy token receives an LLM Proxy tile.
  - [ ] Staff user receives a Staff Directory tile (`href: '/staff/directory'`).
  - [ ] Admin user receives a User Management tile (`href: '/admin/users'`).
  - [ ] Post-login redirect sends Google, GitHub, and Pike13 OAuth users to
        `/account` for all roles (student, staff, admin).

---

## SUC-016-002: Admin opens User Management sub-app from tile
Parent: UC-020

- **Actor**: Admin
- **Preconditions**:
  - Admin is authenticated and on `/account`.
  - The User Management tile is visible in the Apps zone.
- **Main Flow**:
  1. Admin sees the User Management tile in the Apps zone.
  2. Admin clicks the tile.
  3. Browser navigates to `/admin/users`.
  4. The existing admin users panel loads.
- **Postconditions**: Admin is on the User Management page. No change to how
  `/admin/users` itself works.
- **Acceptance Criteria**:
  - [ ] User Management tile is present on `/account` for admin users.
  - [ ] User Management tile is absent for students and staff.
  - [ ] Tile `href` resolves to `/admin/users` and navigates there on click.
  - [ ] `/admin/users` continues to function identically to before this sprint.

---

## SUC-016-003: Student opens LLM Proxy sub-app from tile
Parent: UC-021

- **Actor**: Student with an active LLM proxy token grant
- **Preconditions**:
  - Student is authenticated and on `/account`.
  - The student has an active `LlmProxyToken` row (same condition that shows the
    `AccountLlmProxyCard` today).
- **Main Flow**:
  1. Student sees the LLM Proxy tile in the Apps zone.
  2. Student clicks the tile.
  3. Browser navigates to the LLM proxy documentation or usage URL.
- **Postconditions**: Student has accessed the LLM proxy entry point.
- **Acceptance Criteria**:
  - [ ] LLM Proxy tile is present on `/account` for students with an active
        token.
  - [ ] LLM Proxy tile is absent for students without an active token.
  - [ ] LLM Proxy tile is absent for staff and admin users.
  - [ ] Tile `href` navigates to the LLM proxy entry URL (implementer to confirm
        against existing routing in `client/src/App.tsx`).
