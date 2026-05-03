---
id: "007"
title: "Client: add three permission checkbox columns to GroupDetailPanel member grid"
status: todo
use-cases:
  - SUC-005
depends-on:
  - "004"
  - "006"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: add three permission checkbox columns to GroupDetailPanel member grid

## Description

After ticket 006 removes the Permissions section and ticket 004 wires the server
endpoint, this ticket adds three checkbox columns to `GroupDetailPanel`'s member
grid: OAuth Client, LLM Proxy, League Account. Each checkbox reflects the
member's per-user flag (from the updated `listMembers` API response) and, on
change, fires `PATCH /api/admin/users/:id/permissions` with the single changed
flag. League Account toggle-on shows a brief "Provisioning…" indicator in the
checkbox cell.

## Acceptance Criteria

- [ ] `Member` interface in `GroupDetailPanel.tsx` includes `allowsOauthClient: boolean`, `allowsLlmProxy: boolean`, `allowsLeagueAccount: boolean`.
- [ ] Member grid has three new column headers: "OAuth", "LLM Proxy", "Lg Acct" (or similar short labels).
- [ ] Each member row has three checkbox cells, one per permission flag, reflecting the member's current flag value.
- [ ] Clicking a checkbox fires `PATCH /api/admin/users/:id/permissions` with `{ [field]: newValue }`.
- [ ] On success the checkbox reflects the updated state (optimistic update or re-fetch).
- [ ] On failure an error banner shows the error message; checkbox reverts to previous state.
- [ ] League Account checkbox: when toggling ON, shows a "Provisioning…" label next to the checkbox until the PATCH resolves.
- [ ] Checking "League Account" for a user without a workspace account triggers provisioning (via the server-side side-effect in ticket 004) — no extra client logic needed.
- [ ] The `colSpan` on the "No members yet" empty-state row is updated to cover the new columns.
- [ ] No TypeScript errors; no console warnings.

## Implementation Plan

### Approach

1. Update the `Member` interface to include the three boolean fields.
2. Add a `patchUserPermission(userId, field, value)` async function that calls
   `PATCH /api/admin/users/${userId}/permissions` with `{ [field]: value }`.
3. Add three `<th>` headers after the existing "LLM Proxy" column.
4. In each member row `<tr>`, add three `<td>` cells after the existing LLM
   Proxy cell. Each cell contains a `<input type="checkbox">`.
5. For the League Account checkbox, maintain a per-row pending state
   (e.g., `Set<number>` of user IDs currently provisioning) to show the
   indicator.
6. On checkbox change: call `patchUserPermission`, then invalidate the detail
   query to re-fetch member data with updated flags.
7. Update the "No members yet" empty-state row `colSpan` from 7 to 10.

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — update Member type, add table columns and PATCH logic.

### Testing Plan

- `tests/client/pages/admin/GroupDetailPanel.test.tsx`:
  - Render a group with one member who has `allowsLlmProxy: true`. Assert
    "LLM Proxy" checkbox is checked.
  - Click "OAuth" checkbox for the member. Assert `PATCH /api/admin/users/N/permissions`
    is called with `{ allows_oauth_client: true }`.
  - Simulate PATCH error. Assert error banner appears.
- Run `npm run test:client`.

### Documentation Updates

None required.
