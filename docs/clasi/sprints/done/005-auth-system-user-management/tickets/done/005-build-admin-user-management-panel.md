---
id: '005'
title: Build admin user management panel
status: todo
use-cases:
- SUC-002
- SUC-003
depends-on:
- '002'
- '004'
---

# Build admin user management panel

## Description

Create admin API routes for user CRUD and a React `UsersPanel` component
for the admin dashboard. Admin routes are protected by `requireAdmin()`
middleware. The panel allows admins to list, create, edit roles, and
delete users.

### Changes

1. **Create `server/src/routes/admin/users.ts`**:
   - `GET /api/admin/users` — List all users (delegates to
     `UserService.list()`)
   - `POST /api/admin/users` — Create a new user (accepts `{ email,
     displayName?, role? }`, delegates to `UserService.create()`)
   - `PUT /api/admin/users/:id` — Update a user (accepts
     `{ displayName?, role? }`, delegates to `UserService.update()`)
   - `DELETE /api/admin/users/:id` — Delete a user (delegates to
     `UserService.delete()`)
   - All routes use `requireAdmin()` middleware
   - `PUT` guard: Refuse to demote the last ADMIN user (query count of
     admins before role change; return 400 if it would leave zero admins)

2. **Wire routes in `server/src/app.ts`**:
   - Import and mount admin user routes at `/api/admin/users`

3. **Create `client/src/components/admin/UsersPanel.tsx`**:
   - Fetch and display all users in a table (columns: email,
     displayName, role, provider, createdAt)
   - Create user form (email input + role dropdown)
   - Inline edit or modal for updating user displayName and role
   - Delete button with confirmation dialog
   - Refresh table after create/edit/delete mutations
   - Handle API errors and display feedback

4. **Wire into admin layout**: Import `UsersPanel` into the existing
   admin page/layout so it is accessible from the admin dashboard.

## Acceptance Criteria

- [ ] `GET /api/admin/users` returns a list of all users (admin only)
- [ ] `POST /api/admin/users` creates a new user (admin only)
- [ ] `PUT /api/admin/users/:id` updates user fields (admin only)
- [ ] `DELETE /api/admin/users/:id` deletes a user (admin only)
- [ ] All admin routes return 401 for unauthenticated requests
- [ ] All admin routes return 403 for non-admin users
- [ ] Last ADMIN user cannot be demoted (returns 400 with explanation)
- [ ] `UsersPanel.tsx` displays all users in a table
- [ ] Admin can create a new user from the panel
- [ ] Admin can edit a user's displayName and role from the panel
- [ ] Admin can delete a user with confirmation from the panel
- [ ] Table refreshes after mutations
- [ ] Server compiles with `tsc --noEmit`
- [ ] Client builds with `npm run build` in `client/`

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: Covered in ticket 006 (admin user management tests)
- **Verification command**: `cd server && npx tsc --noEmit && cd ../client && npm run build`
