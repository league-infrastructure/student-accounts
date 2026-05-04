---
status: pending
---

# GroupDetailPanel redesign — passphrase up top, drop bulk buttons, tri-state column toggles

Stakeholder asks captured 2026-05-03 after sprint 027's per-user
permission grid shipped. The Group detail page (`/groups/:id`)
gets four UX changes; all client-side except the new bulk-toggle
flow which reuses existing per-user PATCH.

## A. Title bar reshape

**Current:** Group name + description above; "Delete Group" button
on its own line below the description.

**Target:** Group name on the left, **Delete Group** button on the
far right of the same row. Description stays below the name.

`GroupDetailPanel.tsx:559-618` carries the current layout. Restructure
the title row to a flex with `justify-content: space-between`; the
Delete button moves into the right side of that row.

## B. Passphrase + invitation URL right below title

**Current:** `<PassphraseCard />` already exists and lives at
`GroupDetailPanel.tsx:652-659` — *below* the bulk-action toolbar.
Server has `POST/GET/DELETE /admin/groups/:id/passphrase` already.

**Target:** Move PassphraseCard to render directly under the title /
description block, before any other section. Surface explicitly:
- `Passphrase: <value>` with a **Regenerate** button (rotates via
  the existing POST endpoint).
- `Invitation URL: <value>` with a **Regenerate** button.

**Investigation needed during execution:** the existing
`PassphraseCard` component (in `client/src/pages/admin/...`?) may
already render the passphrase. Inspect it to see whether it
already shows a derivable invitation URL (probably
`https://<host>/signup?passphrase=<value>` or similar). If yes,
reuse; if no, add the URL row alongside.

If the invitation URL is independent of the passphrase (separate
column), we'd need a server addition — flag during execution.
Default assumption: invite URL is a function of the passphrase, so
both are derivable from one `signup_passphrase` value and a single
"regenerate" button suffices. **Confirm during execution; if two
truly distinct artifacts exist, two regenerate buttons.**

## C. Drop the bulk-action toolbar

Remove all five buttons + their handlers + their imports. The
five buttons live at `GroupDetailPanel.tsx:661-700`:
- "Create League ({count})" — `runBulkProvision('workspace')`
- "Remove League ({count})" — `runBulkAll('remove')`
- "Suspend ({count})" — `runBulkAll('suspend')`
- "Grant LLM Proxy ({count})" — opens GrantLlmProxyModal
- "Revoke LLM Proxy ({count})" — `runBulkLlmProxyRevoke()`

All bulk operations move into the new column-header tri-state
toggle (item D). The Grant LLM Proxy modal becomes dead code —
delete the modal too (search for `GrantLlmProxyModal` import).

Drop the row-selection state (`selectedIds`) and the per-row
"Select" checkbox column too — without bulk buttons there's no
purpose for selection.

## D. Tri-state column header toggle (OAuth / LLM Proxy / League Account)

Each of the three permission columns gets a small toggle widget
**next to the column header** showing one of three visual states:

- ☐ **empty** — column is mixed (some rows have it, some don't),
  OR the page just loaded and the toggle hasn't been clicked yet
  (the derived "all on / all off" check is what drives this on
  every render — so the toggle is purely a function of the rows).
- ☑ **check** — every row in the column has the permission.
- ☒ **X** — no row in the column has the permission.

**Display:** derived live from the rows (purely reactive — no
state). On every render the toggle shows the appropriate state.

**Click behavior:**
- When showing **check** (all on): clicking turns it OFF for every
  member (PATCH each user with `allows_X = false`).
- When showing **X** (all off) OR **empty** (mixed): clicking
  turns it ON for every member (PATCH each with `allows_X = true`).

**Implementation:** loop client-side over `data.users` and call
`PATCH /api/admin/users/:userId/permissions` once per row with the
single flag. Reuse the existing per-user endpoint (no new bulk
endpoint needed). Show a global "Updating column…" indicator
while in flight. Each PATCH already triggers the existing per-row
side effects:
- `allows_league_account` true→false: revoke nothing (already
  grandfathered)
- `allows_league_account` false→true: provision Workspace fail-soft
- `allows_llm_proxy` false→true: auto-grant token
- `allows_llm_proxy` true→false: auto-revoke token (sprint 027 fix)

The existing per-row "Provisioning…" indicator on the League
Account checkbox stays — when bulking-on the column, multiple rows
will show it simultaneously.

**Visual choice:** custom three-state button rendering one of `☐`,
`☑`, `☒` glyphs (or small inline SVG). Native `<input
type="checkbox">` only has indeterminate as a horizontal dash, not
an X — we need custom rendering. Plain unicode glyphs are cheapest.

## Stakeholder decisions (locked from message)

- Tri-state semantics: empty = mixed/initial (no state to apply);
  check = all on; X = all off.
- Click cycle: from check → all off; from X or empty → all on.
  (Standard tri-state-with-bulk-set behavior.)
- Bulk apply uses per-user PATCH loop, not a new bulk endpoint.

## Implementation order (single ticket, sized for the open sprint 027)

1. Move Delete to title-bar right.
2. Hoist PassphraseCard above all sections (and inspect it to
   confirm/extend the URL surfacing).
3. Delete the bulk-action toolbar block, GrantLlmProxyModal import,
   runBulk* handlers, selectedIds state, the per-row select column,
   the select-all checkbox, and any now-orphaned style constants.
4. Add `ColumnTriToggle` component (purely visual three-state
   button) and wire one per permission column header.
5. Add `bulkSetPermission(field, value)` that loops PATCHes through
   `data.users` and invalidates the group detail query at the end.
   Surface a brief "Updating…" pill in the column header while in
   flight.
6. Update tests in `tests/client/GroupDetailPanel.test.tsx`:
   - Drop tests asserting the deleted bulk buttons.
   - Add tests for the tri-state toggle visual state across
     mixed/all-on/all-off fixtures.
   - Add a click-toggle test that asserts N PATCH calls with the
     right body.
   - Add a test that the Delete button now lives in the title row.

## Out of scope

- Server changes (no new bulk endpoint; reuse per-user PATCH).
- Redesigning the per-row checkboxes (still bound to the per-user
  flag).
- Auditing the bulk operation as a single "bulk_permission_set"
  event — N individual `user_permission_changed` audit events get
  written by the per-user PATCH path. Acceptable for now; a
  consolidated audit is a follow-up if it matters.
- Re-adding any of the dropped bulk-action buttons.

## Risk

- Looping per-user PATCH can be slow on a large group (e.g. 50
  members × ~50ms each = 2.5s). The "Updating…" indicator should
  be visible. If groups grow much larger, a server-side bulk
  endpoint becomes worth doing — note as a future consideration.
- The League Account toggle bulk-on triggers up to N synchronous
  Workspace provisioning fan-outs. Each is fail-soft per user
  (sprint 027 ticket 005). If Google Workspace API throttles,
  some rows will silently skip. The per-row "Provisioning…"
  indicator and subsequent SSE refresh should make eventual state
  visible.

## Verification

- Manual smoke: load a group with mixed permissions; confirm each
  column header shows ☐. Toggle one off in a column → header still
  ☐. Toggle all in a column → header flips to ☑. Click header →
  every row unchecks; header flips to ☒. Click header → every row
  checks; header flips to ☑.
- Manual smoke: passphrase visible right under title; Regenerate
  rotates and shows new value. Delete Group lives top-right.
- Tests: `npm run test:client -- GroupDetailPanel` green; sprint
  baseline holds.
