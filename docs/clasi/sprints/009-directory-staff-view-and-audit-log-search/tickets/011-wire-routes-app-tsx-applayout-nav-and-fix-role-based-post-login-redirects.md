---
id: "011"
title: "Wire routes, App.tsx, AppLayout nav, and fix role-based post-login redirects"
status: todo
use-cases: [SUC-009-009]
depends-on: ["004", "005", "006", "007", "008", "009", "010"]
github-issue: ""
todo: ""
---

# Wire routes, App.tsx, AppLayout nav, and fix role-based post-login redirects

## Description

Integration ticket: wire together all new pages and server routes created by
T004–T010. Ensure `App.tsx` has the correct client routes, `AppLayout.tsx`
shows the right nav links per role, `app.ts` mounts the staff directory router,
and `server/src/routes/auth.ts` redirects each role to the correct landing page
after OAuth sign-in.

## Acceptance Criteria

- [ ] `App.tsx` contains routes:
      - `/staff/directory` wrapped in `<StaffLayout>` → `<StaffDirectory>`.
      - `/admin/audit-log` wrapped in `<AdminLayout>` → `<AuditLogPanel>`.
- [ ] `AppLayout.tsx` nav:
      - "Directory" link (`/staff/directory`) visible only when
        `user.role === 'staff'`.
      - "Audit Log" link (`/admin/audit-log`) visible only when
        `user.role === 'admin'`.
      - Existing admin-only links remain unchanged.
- [ ] `server/src/app.ts` mounts `staffDirectoryRouter` at `/api`.
- [ ] Google OAuth callback in `server/src/routes/auth.ts` redirects:
      - `role=admin` → `/admin/users`.
      - `role=staff` → `/staff/directory`.
      - `role=student` → `/account`.
- [ ] GitHub OAuth callback applies the same redirect logic.
- [ ] A staff user cannot navigate to `/admin/*` routes in the browser (blocked
      by `AdminLayout` guard).
- [ ] A student user cannot navigate to `/staff/*` routes (blocked by
      `StaffLayout` guard).
- [ ] Manual end-to-end: sign in as staff via Google → lands on
      `/staff/directory`; sign in as admin → lands on `/admin/users`.

## Implementation Plan

**Files to modify:**
- `client/src/App.tsx` — add imports + routes for `StaffLayout`, `StaffDirectory`,
  `AuditLogPanel`.
- `client/src/components/AppLayout.tsx` — add conditional nav links.
- `server/src/app.ts` — mount `staffDirectoryRouter`.
- `server/src/routes/auth.ts` — update post-login redirect logic. Grep for
  the current redirect destination in the Google and GitHub OAuth callbacks
  to find the exact lines to change (see OQ-001 in architecture-update.md).

**Auth redirect sketch:**
```typescript
function postLoginRedirect(role: string): string {
  if (role === 'admin' || role === 'ADMIN') return '/admin/users';
  if (role === 'staff') return '/staff/directory';
  return '/account';
}
// in callback: res.redirect(postLoginRedirect(req.user.role));
```

**Testing plan:**
- Manual: full sign-in flows for each role.
- Manual: direct navigation to guarded routes as wrong role.
- Existing auth tests: run `npm run test:server` to verify no regressions in
  OAuth callback routes.

**Documentation updates:** None required.
