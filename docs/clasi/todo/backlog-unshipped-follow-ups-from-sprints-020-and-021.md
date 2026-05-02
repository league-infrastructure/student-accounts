---
status: pending
---

# Backlog: unshipped follow-ups from sprints 020 and 021

A consolidated catch-all of work that was promised, deferred, or
discussed but not delivered as of the close of sprint 021. Each item
should be picked up in a future sprint (likely two or three sprints
worth, grouped by theme).

---

## A. Add-Login buttons available to staff and admin

**What was promised** (sprint 020 source TODO,
`docs/clasi/todo/done/plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md`):

> Account page becomes identity-only — name, optional username/password,
> linked logins, three Add-Login buttons (Google / GitHub / Pike 13).
> Always-visible buttons per the user's direction; idempotent re-link
> is a no-op.

**What shipped:** Account page identity sections (Profile, Logins
including Add buttons, UsernamePasswordSection, Workspace temp-pw)
render only when `isStudent`. The Add Google / Add GitHub / Add
Pike 13 buttons live inside `LoginsSection` at
`client/src/pages/Account.tsx:267-294`, which is wrapped by
`{isStudent && data && (…)}` at `Account.tsx:468`. Staff and admin
see no buttons.

**Why:** The `/api/account` endpoint at `server/src/routes/account.ts:32-35`
is gated by `requireRole('student')`, so non-students get 403 and the
client suppresses the section.

**What to do:**

1. Widen `/api/account` to all authenticated roles. Return the same
   response shape; for non-students, `externalAccounts`,
   `workspaceTempPassword`, `llmProxyEnabled`, `cohort` may be
   appropriately empty/null/false. Profile fields, logins, and
   credential fields are universal.
2. Drop the `isStudent` wrap on the identity sections in
   `Account.tsx`. Render Profile, Logins (with Add buttons), and
   UsernamePasswordSection for every authenticated user.
3. Workspace block stays student-only (or shows nothing for
   non-students who have no workspace ExternalAccount — current
   conditional already handles that).
4. Tests for staff and admin Account page rendering.

---

## B. Scope ceilings on non-admin OAuth client registration

**What was deferred** (sprint 020 sprint.md line 102, repeated in
sprint 021 out-of-scope):

> Scope ceilings on non-admin OAuth client registration (TODO follow-up).

**Risk:** A student can register an OAuth client requesting the
`users:read` scope and read the entire user directory through their
own client. Privilege escalation by design — explicitly accepted as
a temporary state at sprint 020 close.

**Code marker:** `client/src/pages/OAuthClients.tsx` carries a
`// TODO (sprint.md "Out of Scope: Scope ceilings"): add server-side
gating` comment.

**What to do:**

1. Define the scope policy. Likely: students may request `profile`
   only; staff may request `profile` and `users:read`; admin may
   request anything.
2. Enforce server-side in `oauth-client.service.ts` create/update
   paths — reject scopes the actor's role isn't allowed to grant
   with a typed error → 403.
3. Surface in the client form: hide checkboxes the user can't
   request, or show them disabled with a "requires staff/admin"
   tooltip.
4. Tests for each role × each scope.

---

## C. OAuth client per-user caps + admin shared pool (stakeholder direction)

**Stakeholder direction (2026-05-01):**

- **Students:** limited to **one** OAuth client total.
- **Admins:** **no limit**.
- **Admin clients are shared.** Any admin can see, edit, rotate, and
  delete any other admin's OAuth client (the pool is collective, not
  per-user).
- **Students see only their own** (no change — already enforced by
  sprint 020's ownership filter).
- **Staff:** unspecified. Default proposal: same cap as students
  (one client). Confirm with stakeholder before implementing.

**Current state (sprint 020):** ownership filter already in place —
non-admins see only their own clients; admins see all. The
visibility rule for admins matches what the stakeholder now wants;
no change needed there. What's new: enforce the cap, and make sure
the "admin pool is collective" model is reflected explicitly (any
admin can mutate any other admin's client — this is already true
because the service-layer admin override applies to all mutations,
not just reads, but worth a test).

**What to do:**

1. Add a `MAX_CLIENTS_PER_USER` policy: 1 for students (and probably
   staff — confirm), unlimited for admin. Enforce in
   `oauth-client.service.ts` create path — count existing clients
   where `created_by = actorUserId`, reject with typed error → 403
   (or 409) when the cap is reached.
2. Surface in the OAuth Clients page: hide / disable the "Create
   client" form (or button) when the user is at their cap; show a
   friendly message explaining why.
3. Tests:
   - student with zero clients can create one;
   - student with one client cannot create a second (cap error);
   - admin can create N clients without hitting any cap;
   - admin A can edit / rotate / delete admin B's client (shared
     pool invariant — verify it's already enforced and add a test
     so it doesn't regress).
4. Audit-event coverage for cap-rejected create attempts (so we can
   see students bumping the wall).

---

## D. Drop the `/api/admin/oauth-clients` and `/admin/oauth-clients` compat redirects

**What was deferred** (sprint 020 sprint.md "Out of Scope"):

> Removing the `/admin/oauth-clients` and `/api/admin/oauth-clients`
> redirects (defer to a follow-up release).

**What to do:**

1. Confirm no in-flight client uses the old paths (search code,
   docs, MCP setup guide).
2. Delete `oauthClientsCompatRouter` and its mount in
   `server/src/app.ts`; delete the `<Navigate to="/oauth-clients" />`
   route in `client/src/App.tsx`.
3. Remove the redirect tests.

---

## E. Sprint 021 polish punch-list

These came up during the sprint 021 stakeholder review and were
patched on the open branch (commits `198d4d3`, `9d34306`,
`fc4d362`). Bundling them here for visibility — they are NOT
unshipped, just listed for completeness:

- Account restored as the first sidebar nav link for all users.
- Dashboard moved to second position for admins.
- Accordion behavior on collapsible sidebar groups (only one open at a time).
- Fix: blank-page bug — moved `useQuery` above the conditional return
  in `AppLayout.tsx` so the hook order is stable across the
  loading→resolved transition.

A regression test for the loading→resolved hook-order transition in
`AppLayout` would be a worthwhile add — the existing tests mock
`useAuth` to return `loading: false` immediately and never traverse
the failing path.

---

## F. Open question: bundle vs split into multiple sprints

These items naturally split:

- **Sprint 022 — Identity for everyone** (item A + item E test): widen
  `/api/account`, render Account sections for all roles, regression
  test for hook-order. Small and self-contained.
- **Sprint 023 — OAuth clients hardening** (items B + C + D): scope
  ceilings, per-user caps + admin shared-pool tests, drop compat
  redirects. Theme: tighten the sprint-020 democratization. Largest
  of the three.

That's the recommended split. Stakeholder can also choose to bundle
everything into one bigger sprint, or pull D forward into 022 if it
feels trivial.

---

## Open clarifications needed before sprint planning

1. **Staff cap on OAuth clients** (item C). Same cap as students
   (one client) or unlimited like admins? Default assumption: same
   as students.
2. **Staff scope ceiling** (item B). May staff request `users:read`
   or only `profile`? Default assumption: `users:read` allowed for
   staff.
3. **Add-Login buttons for staff/admin** (item A). Confirm we want
   ALL three buttons (Google, GitHub, Pike 13) for staff/admin —
   not a subset.
