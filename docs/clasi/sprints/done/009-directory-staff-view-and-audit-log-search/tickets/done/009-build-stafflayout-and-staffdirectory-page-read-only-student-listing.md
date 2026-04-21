---
id: "009"
title: "Build StaffLayout and StaffDirectory page (read-only student listing)"
status: done
use-cases: [SUC-009-007]
depends-on: ["004"]
github-issue: ""
todo: ""
---

# Build StaffLayout and StaffDirectory page (read-only student listing)

## Description

Create the client-side staff directory experience: a `StaffLayout` route guard
and a `StaffDirectory` page that fetches from the T004 endpoint
(`GET /api/staff/directory`) and renders a read-only student listing with
search and filter. No action buttons, no provisioning controls.

Per OQ-002: reuse `AppLayout`'s sidebar shell rather than building a new one.
Add a "Directory" nav link that appears only for staff users.

## Acceptance Criteria

- [x] `StaffLayout.tsx` is a route guard: renders `<Outlet>` for `role=staff`
      (and `role=admin` for admin test access); redirects to `/account` for
      other roles.
- [x] `StaffDirectory.tsx` fetches `GET /api/staff/directory` on mount.
- [x] Displays a table of students: Name (using `prettifyName`), Email, Cohort,
      External Account types (icon or badge per type).
- [x] Search box: substring match on name + email (client-side, within current
      filter).
- [x] Filter by cohort and External Account status (has Workspace, has Claude,
      has Pike13).
- [x] Clicking a student row shows a read-only profile view (inline or a simple
      detail section): display name, email, cohort, account statuses. No buttons.
- [x] No provisioning, merge, or audit-log controls are rendered anywhere on
      this page.
- [x] `AppLayout.tsx` nav: "Directory" link at `/staff/directory` visible only
      when `user.role === 'staff'`.

## Implementation Plan

**Files to create:**
- `client/src/pages/staff/StaffLayout.tsx`
- `client/src/pages/staff/StaffDirectory.tsx`

**Files to modify:**
- `client/src/components/AppLayout.tsx` — add staff-only "Directory" nav link.
- `client/src/App.tsx` — add routes (done in T011, but stub the route here or
  coordinate with T011).

**StaffLayout sketch:**
```tsx
export default function StaffLayout() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'staff' && user.role !== 'admin') return <Navigate to="/account" replace />;
  return <Outlet />;
}
```

**StaffDirectory sketch:**
- `useState` for `students`, `loading`, `error`, `search`, `filter`.
- `useEffect` → `fetch('/api/staff/directory')`.
- Render table with `prettifyName` (import from T006's utility).
- No `Link` components to detail pages — read-only display only.

**Testing plan:**
- Manual: sign in as a staff user; verify redirect to `/staff/directory`; verify
  no admin nav links visible (admin links hidden from non-admin users by
  `AppLayout`).
- Manual: verify search and filter work; verify clicking a row shows read-only
  profile; verify no action buttons present.
- Manual: sign in as a student; navigate to `/staff/directory` directly; verify
  redirect to `/account`.

**Documentation updates:** None required.
