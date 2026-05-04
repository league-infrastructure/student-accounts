---
id: '005'
title: GroupDetailPanel move Delete to title bar and hoist PassphraseCard
status: todo
use-cases:
  - SUC-005
  - SUC-006
depends-on: []
github-issue: ''
todo: groupdetailpanel-redesign-passphrase-up-top-drop-bulk-buttons-tri-state-column-toggles.md
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GroupDetailPanel move Delete to title bar and hoist PassphraseCard

## Description

Two targeted layout changes to `client/src/pages/admin/GroupDetailPanel.tsx`:

**A. Title row**: Move the "Delete Group" button from its own `<div>` row below the description
into the title row alongside the group name h2. Use `justifyContent: 'space-between'` so the
name is on the left and Delete is on the right.

**B. PassphraseCard hoist**: Move the `<PassphraseCard>` block from its current position
(after banners, before bulk buttons) to immediately below the description `<p>` tag — making
it the first content item after the group header.

Also inspect `PassphraseCard` to confirm whether it already surfaces the invitation URL. Note
the finding in the commit; if a URL row is missing and a follow-up ticket is needed, note that
as a blocker comment — do not add it here (out of scope per architecture-update.md open question 1).

## Acceptance Criteria

- [ ] The group name `<h2>` and "Delete Group" button share a single flex row with `justifyContent: 'space-between'`.
- [ ] No separate `<div>` row below the description renders the Delete button.
- [ ] `<PassphraseCard>` renders before the banners block OR immediately after the description — whichever produces the correct visual order: title row → description → passphrase card → banners → member table.
- [ ] `<PassphraseCard>` does not appear after the bulk-action buttons (which still exist in this ticket — removal is ticket 006).
- [ ] Inspection note: confirm in the commit whether `PassphraseCard` surfaces the invitation URL; note finding.
- [ ] Existing tests that assert on Delete button position are updated (or new tests added) to confirm the button is in the title row.
- [ ] `npm run test:client -- GroupDetailPanel` passes.

## Implementation Plan

### Approach

In `client/src/pages/admin/GroupDetailPanel.tsx`, in the non-editing title block (the `<>` branch
at line ~583):

**Part A — Title row**:
1. Locate the `<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>` that contains the `<h2>`.
2. Change that div's style to `display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4`.
3. Move the `<button onClick={deleteGroup} style={dangerSmallBtn}>Delete Group</button>` from the separate `<div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>` block into this flex row, as the last child.
4. Delete the now-empty separate `<div>` row that held Delete.

**Part B — PassphraseCard hoist**:
1. Locate the `{Number.isFinite(numericId) && <PassphraseCard ... />}` block (currently after banners, before bulk buttons, around line 652-659).
2. Move it to render immediately after the description `<p>` tag and before the banner `{banner && ...}` block.

**Inspection task**: open `client/src/components/PassphraseCard.tsx` and check whether it renders an invitation URL row. Note in the commit message what you found. If the URL is missing and needs to be added, open a follow-up note — do not add it in this ticket.

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — layout changes per above

### Testing Plan

In `tests/client/pages/GroupDetailPanel.test.tsx` (or equivalent):
- Add test: render the component with a group fixture; assert the Delete button is within the same container as the group name h2 (e.g., check that both are children of the same parent with `justify-content: space-between`).
- Add test: assert `PassphraseCard` renders before the member table.
- Remove or update any test that asserted Delete was in a separate row below the description.

Run: `npm run test:client -- GroupDetailPanel`
