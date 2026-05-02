---
id: "005"
title: "Client — OAuth Clients page UX for caps and scope ceilings"
status: todo
use-cases:
  - SUC-023-001
  - SUC-023-002
  - SUC-023-003
  - SUC-023-004
depends-on:
  - "023-001"
  - "023-002"
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client — OAuth Clients page UX for caps and scope ceilings

## Description

The server now enforces scope ceilings and per-user caps (tickets 001 and 002),
but the client still shows all scope checkboxes to all users and always shows
the create form. This ticket updates `OAuthClients.tsx` to:

1. Show only the scope checkboxes the actor's role can request.
2. Replace the "+ New OAuth Client" button with an explanatory message when
   the actor is at their cap.
3. Remove the two TODO comments about scope ceilings.

The client enforcement is UX-only — the server remains the authoritative policy
enforcer. If a user bypasses the UI, the server 403 is the safety net.

## Acceptance Criteria

- [ ] A student sees only the `profile` checkbox in the create form; `users:read` is not rendered.
- [ ] A staff user sees both `profile` and `users:read` checkboxes.
- [ ] An admin sees both `profile` and `users:read` checkboxes.
- [ ] A student with one active client sees no create button and instead sees a message such as "You have reached your OAuth client limit (1). Disable your existing client to create a new one."
- [ ] A student with zero clients (or with all clients disabled) sees the normal "+ New OAuth Client" button.
- [ ] Staff and admin always see the create button regardless of how many clients they own.
- [ ] Both `// TODO (sprint.md "Out of Scope: Scope ceilings")` comments are removed from `OAuthClients.tsx`.
- [ ] TypeScript compilation passes with no new errors.

## Implementation Plan

### Approach

Add two client-side const policy maps (mirroring the server's policy modules
but as plain TypeScript consts — no shared import). Derive `allowedScopes`
and `isAtCap` from `user.role` and the loaded `clients` list.

### Files to Modify

- `client/src/pages/OAuthClients.tsx`:
  1. Add policy consts near the top (after the `SUPPORTED_SCOPES` const):
     ```
     const ALLOWED_SCOPES_BY_ROLE: Record<string, string[]> = {
       student: ['profile'],
       staff: ['profile', 'users:read'],
       admin: ['profile', 'users:read'],
     };
     const MAX_CLIENTS_BY_ROLE: Record<string, number | null> = {
       student: 1,
       staff: null,
       admin: null,
     };
     ```
  2. Inside `OAuthClients()`, derive:
     ```
     const role = user?.role ?? 'student';
     const allowedScopes = ALLOWED_SCOPES_BY_ROLE[role] ?? SUPPORTED_SCOPES;
     const maxClients = MAX_CLIENTS_BY_ROLE[role] ?? null;
     const activeClientCount = clients.filter(c => !c.disabled_at).length;
     const isAtCap = maxClients !== null && activeClientCount >= maxClients;
     ```
  3. In `ScopeCheckboxGroup` call site in the create form: render only the
     intersection of `SUPPORTED_SCOPES` and `allowedScopes`. The simplest
     approach is to pass `allowedScopes` as a prop to `ScopeCheckboxGroup`
     and filter internally, OR filter `SUPPORTED_SCOPES` before mapping in
     the component itself.
  4. Replace the `<button onClick={() => setShowCreateForm(true)}>` block
     with a conditional: if `isAtCap`, render the explanatory message; else
     render the button.
  5. Remove the two TODO comments (lines 27-29 and 333-335 approximately).

### Testing Plan

Add tests to `tests/client/pages/OAuthClients.test.tsx`:

- **Student with 0 clients**: render with `role: 'student'` and empty clients list.
  - Assert only `data-testid="scope-checkbox-profile"` is in the document.
  - Assert `data-testid="scope-checkbox-users:read"` is NOT in the document.
  - Assert "+ New OAuth Client" button is present.

- **Student at cap (1 client)**: render with `role: 'student'` and one active client in the list.
  - Assert "+ New OAuth Client" button is NOT present.
  - Assert a cap message is visible (e.g., text matching /reached your.*limit/i).

- **Admin with 3 clients**: render with `role: 'admin'` and three active clients.
  - Assert both scope checkboxes render.
  - Assert "+ New OAuth Client" button is present.

Use the existing `apiFetch` mock pattern in the test file.

### Documentation Updates

The two TODO comments (`// TODO (sprint.md "Out of Scope: Scope ceilings")`)
are removed as part of the code change above.
