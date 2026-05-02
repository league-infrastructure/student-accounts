---
id: '002'
title: "Client \u2014 drop isStudent gate; render identity sections for all roles"
status: done
use-cases:
- SUC-022-001
- SUC-022-002
- SUC-022-003
depends-on:
- '001'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client — drop isStudent gate; render identity sections for all roles

## Description

`Account.tsx` currently wraps the identity sections (ProfileSection,
LoginsSection, UsernamePasswordSection) in `{isStudent && data && (...)}`.
The `useQuery` that fetches `/api/account` is also gated with
`enabled: isStudent`. After ticket 001 widens the server endpoint, these
client guards are no longer needed and must be removed.

The goal is for staff and admin users to see the same identity surface that
students see: their profile, their linked logins, all three Add-Login buttons
(Google, GitHub, Pike 13), and UsernamePasswordSection if they have
credentials set.

WorkspaceSection is not explicitly role-gated in this ticket; its existing
internal nullcheck already handles the non-student case (returns null when no
workspace ExternalAccount and no League-format primary email).

## Acceptance Criteria

- [x] `useQuery(['account'])` is enabled for any authenticated user
      (`enabled: !!user && !loading`), not just students.
- [x] The loading spinner is shown for all roles while the query is in flight
      (not only for `isStudent`).
- [x] The error state is shown for all roles if the query fails (not only for
      `isStudent`).
- [x] ProfileSection renders for staff and admin users.
- [x] LoginsSection renders for staff and admin users.
- [x] All three Add-Login buttons (Add Google, Add GitHub, Add Pike 13) are
      visible on the Account page for staff and admin users (subject to
      `providerStatus` gating for Google and GitHub, same as students).
- [x] UsernamePasswordSection renders for staff/admin users who have
      `username` or `has_password` set; hidden otherwise.
- [x] WorkspaceSection is visible for users whose `externalAccounts` includes
      a workspace entry, or whose `primaryEmail` is a League address; hidden
      otherwise — unchanged from existing behavior.
- [x] The student Account page experience is unchanged (regression guard).
- [x] `isStudent` variable may be removed from Account.tsx if it has no
      remaining usages after this ticket.
- [x] Client test suite passes at or above baseline; new staff/admin tests
      pass (see testing section).

## Implementation Plan

### Approach

Targeted edits inside `client/src/pages/Account.tsx`:

1. **Widen the query `enabled` flag.** Replace:
   ```ts
   enabled: isStudent,
   ```
   With:
   ```ts
   enabled: !loading && !!user,
   ```
   This matches the pattern used in `AppLayout.tsx`.

2. **Widen the loading early-return.** Replace:
   ```ts
   if (isStudent && isLoading) {
   ```
   With:
   ```ts
   if (isLoading) {
   ```

3. **Widen the error early-return.** Replace:
   ```ts
   if (isStudent && (isError || !data)) {
   ```
   With:
   ```ts
   if (isError || !data) {
   ```

4. **Remove the isStudent wrap from the identity sections.** Replace:
   ```tsx
   {isStudent && data && (
     <>
       <ProfileSection ... />
       ...
       <WorkspaceSection data={data} />
       ...
     </>
   )}
   ```
   With the inner fragment directly (no conditional wrapper). The sections
   already receive data as a prop; this is the only change needed.

5. **Fix hasCredentials.** Replace:
   ```ts
   const hasCredentials =
     isStudent &&
     data != null &&
     ((data.profile.username ?? null) !== null || data.profile.has_password === true);
   ```
   With:
   ```ts
   const hasCredentials =
     data != null &&
     ((data.profile.username ?? null) !== null || data.profile.has_password === true);
   ```

6. **Remove `isStudent` variable** if it has no remaining usages. Check
   before deleting.

7. **Update the file-level JSDoc comment** at the top of `Account.tsx`.
   The current comment says "Student-only sections (Profile, Logins,
   UsernamePassword) are shown only when role === 'student'." Replace with
   an accurate description of the widened behavior.

### Files to Modify

- `client/src/pages/Account.tsx` — per steps above.
- `tests/client/pages/Account.test.tsx` — see testing section.

### Files to Leave Unchanged

- `client/src/components/AppLayout.tsx` — already uses the correct pattern.
- `client/src/pages/account/UsernamePasswordSection.tsx` — no role logic.
- `WorkspaceSection` is inline in `Account.tsx`; its logic is unchanged.

### New / Updated Tests

In `tests/client/pages/Account.test.tsx`:

1. **Flip the existing admin "does not show student-only sections" test.**
   Currently it asserts that ProfileSection heading and LoginsSection heading
   are NOT in the document. After this ticket they SHOULD be in the document.
   Change the assertions to `toBeInTheDocument()` and pass `makeFetch(true)`
   (which returns account data) to the fetch mock.

2. **Flip the existing staff "does not show student-only sections" test.**
   Same change as above for the staff test.

3. **Add an admin-specific Add-Login button test** asserting that all three
   Add buttons ("Add Google", "Add GitHub", "Add Pike 13") are visible for
   an admin user when providerStatus returns all three configured.

4. **Add a staff-specific Add-Login button test** — same assertions for staff
   role.

5. **Keep the student regression test** passing without changes.

Pattern for the new tests:

```ts
it('renders Profile and Logins sections for admin', async () => {
  mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
  (globalThis as any).fetch = makeFetch(true); // returns account data
  renderAccount();
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
  });
  // Profile heading
  expect(screen.getByText('Test admin')).toBeInTheDocument();
  // Logins section
  expect(screen.getByRole('heading', { name: /sign-in methods/i })).toBeInTheDocument();
  // Add buttons
  expect(screen.getByRole('link', { name: /add google/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /add github/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /add pike 13/i })).toBeInTheDocument();
});
```

The `makeFetch` helper already supports returning admin-shaped account data
(the profile shape is role-neutral). Pass `includeStudentAccount: true` and
set the profile `role` field to `'admin'` via `accountOverrides`.

### Testing Plan

Run `npm run test:client` after changes. All existing tests should continue to
pass; the formerly-asserting-absence tests are rewritten to assert presence.
