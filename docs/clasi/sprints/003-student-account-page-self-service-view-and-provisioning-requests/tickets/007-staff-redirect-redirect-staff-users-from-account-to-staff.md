---
id: "007"
title: "Staff redirect — redirect staff users from /account to /staff"
status: todo
use-cases: [SUC-001]
depends-on: ["006"]
github-issue: ""
todo: ""
---

# Staff redirect — redirect staff users from /account to /staff

## Description

Staff users (role=staff) must not see the student account page. When a staff
user navigates to `/account`, they should be redirected to `/staff` immediately.

This is a small, focused ticket. The frontend redirect is already specified in
T006 as part of AccountPage (render `<Navigate to="/staff" replace />` when
role=staff). However, it is isolated here to ensure explicit test coverage for
the staff routing behavior and to keep T006 focused on the student view.

Note: The `/staff` route itself (Sprint 002's 200 placeholder) is NOT replaced
in this sprint — that is Sprint 009. This ticket only ensures the redirect
happens correctly from the frontend.

The backend account API routes already return 403 for staff/admin (specified
in T002). This ticket covers the frontend routing behavior.

## Acceptance Criteria

- [ ] A staff user navigating to `/account` in the browser is redirected to
      `/staff` without rendering any account content.
- [ ] The redirect uses `<Navigate to="/staff" replace />` so the `/account`
      URL is not retained in browser history.
- [ ] A student user navigating to `/account` sees the AccountPage normally
      (no regression from T006).
- [ ] An admin user navigating to `/account` — define behavior: redirect to
      `/staff` or show an appropriate page. For this sprint, redirect to `/staff`
      (admin-specific account page is out of scope). This is the simplest safe
      default.

## Implementation Plan

### Approach

This is primarily a verification and test ticket. The redirect logic is
implemented in T006 as part of AccountPage. This ticket adds dedicated tests
and confirms the implementation is correct.

If the T006 implementer deferred the staff redirect to this ticket, add it to
AccountPage here:

```tsx
// In AccountPage, before useQuery or after user check:
if (user?.role === 'staff' || user?.role === 'admin') {
  return <Navigate to="/staff" replace />;
}
```

The redirect should fire before any `useQuery` call to avoid an unnecessary
API round-trip that will return 403 anyway.

### Files to Modify

- `client/src/pages/Account.tsx` — confirm or add the role-based redirect

### Testing Plan

Add to `tests/client/pages/Account.test.tsx`:

1. Staff user renders Account route → `<Navigate to="/staff">` rendered
   (use React Router MemoryRouter to check the redirect).
2. Admin user renders Account route → redirected to /staff.
3. Student user renders Account route → AccountPage content rendered
   (regression from T006).

Also add a smoke test in `tests/server/routes/account.test.ts`:
- Staff session user hits `GET /api/account` → 403 (already covered in T002;
  verify regression does not occur).
