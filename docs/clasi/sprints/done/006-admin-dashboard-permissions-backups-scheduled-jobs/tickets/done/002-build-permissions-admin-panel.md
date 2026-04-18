---
id: '002'
title: Build permissions admin panel
status: todo
use-cases:
- SUC-001
depends-on:
- '001'
---

# Build permissions admin panel

## Description

Create the admin API routes for permissions CRUD and the `PermissionsPanel`
React component. This gives administrators a UI to manage role assignment
patterns that control automatic role assignment on OAuth login.

### Changes

1. **`server/src/routes/admin/permissions.ts`** — Admin API routes:
   - `GET /api/admin/permissions/patterns` — List all role assignment patterns.
     Returns JSON array of patterns.
   - `POST /api/admin/permissions/patterns` — Create a new pattern. Request
     body: `{ matchType, pattern, role }`. Returns the created pattern.
   - `PUT /api/admin/permissions/patterns/:id` — Update an existing pattern.
     Request body: `{ matchType?, pattern?, role? }`. Returns updated pattern.
   - `DELETE /api/admin/permissions/patterns/:id` — Delete a pattern. Returns
     204 on success.
   - All routes use `requireAdmin` middleware.

2. **Mount routes** in the admin route index file.

3. **`client/src/components/admin/PermissionsPanel.tsx`** — React component:
   - Table listing all patterns with columns: match type, pattern, role,
     created date.
   - "Add Pattern" form with: match type selector (exact/regex), pattern text
     input, role dropdown (USER/ADMIN).
   - Edit action per row (inline or modal).
   - Delete action per row with confirmation dialog.
   - Error display for invalid patterns (e.g., bad regex).
   - Loading state while fetching.

4. **Register the panel** in the admin dashboard page/layout.

## Acceptance Criteria

- [ ] `GET /api/admin/permissions/patterns` returns all patterns as JSON
- [ ] `POST /api/admin/permissions/patterns` creates a pattern and returns it
- [ ] `PUT /api/admin/permissions/patterns/:id` updates a pattern
- [ ] `DELETE /api/admin/permissions/patterns/:id` deletes a pattern (204)
- [ ] All routes return 403 for non-admin users
- [ ] All routes return 401 for unauthenticated requests
- [ ] `PermissionsPanel` renders the pattern list
- [ ] Admin can add a new pattern via the form
- [ ] Admin can edit an existing pattern
- [ ] Admin can delete a pattern with confirmation
- [ ] Invalid regex patterns show an error message

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Covered in ticket 007
- **Verification command**: `cd server && npx tsc --noEmit`
