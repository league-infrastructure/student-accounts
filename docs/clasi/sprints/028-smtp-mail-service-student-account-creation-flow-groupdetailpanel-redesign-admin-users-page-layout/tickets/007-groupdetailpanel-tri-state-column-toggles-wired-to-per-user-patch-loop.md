---
id: "007"
title: "GroupDetailPanel tri-state column toggles wired to per-user PATCH loop"
status: todo
use-cases:
  - SUC-008
depends-on:
  - "006"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GroupDetailPanel tri-state column toggles wired to per-user PATCH loop

## Description

Add `ColumnTriToggle` — a stateless three-state indicator widget — to each of the three
permission column headers in the `GroupDetailPanel` member table (OAuth Client, LLM Proxy,
League Account). The toggle derives its state (all-on / all-off / mixed) from the current row
data on every render. Clicking it fires a `bulkSetPermission(field, value)` function that loops
`PATCH /api/admin/users/:userId/permissions` over all group members and invalidates the group
detail query on completion.

**Depends on ticket 006** — the select column and bulk toolbar must already be gone before this
ticket reshapes the column headers.

No new server endpoint is added; the existing per-user PATCH is reused.

## Acceptance Criteria

- [ ] `ColumnTriToggle` component (file-local or extracted) renders: a check glyph when all rows have the permission; an X glyph when no rows have it; an empty-square glyph when mixed.
- [ ] `triState(field, users)` is a pure function of `data.users` — no extra state.
- [ ] Each of the three permission column headers (OAuth, LLM Proxy, Lg Acct) contains a `<ColumnTriToggle>` widget.
- [ ] Clicking the toggle when showing check: calls `bulkSetPermission(field, false)` → all rows receive `PATCH { allows_X: false }`.
- [ ] Clicking the toggle when showing X or mixed: calls `bulkSetPermission(field, true)` → all rows receive `PATCH { allows_X: true }`.
- [ ] A per-column "Updating..." indicator is visible while PATCHes are in-flight.
- [ ] Group detail query is invalidated (refetched) after all PATCHes settle (resolved or rejected).
- [ ] Each PATCH failure is logged but does not abort the remaining PATCHes (fail-soft per row).
- [ ] No new server endpoint is added.
- [ ] Client tests pass (see Testing Plan).

## Implementation Plan

### Approach

In `client/src/pages/admin/GroupDetailPanel.tsx`:

**1. `triState` helper**:
```typescript
type TriState = 'all-on' | 'all-off' | 'mixed';
type PermField = 'allowsOauthClient' | 'allowsLlmProxy' | 'allowsLeagueAccount';

function triState(field: PermField, users: Member[]): TriState {
  if (users.length === 0) return 'mixed';
  const onCount = users.filter((u) => u[field]).length;
  if (onCount === users.length) return 'all-on';
  if (onCount === 0) return 'all-off';
  return 'mixed';
}
```

**2. `bulkSetPermission` function**:
```typescript
async function bulkSetPermission(field: PermField, value: boolean) {
  setColumnBusy(field);
  try {
    await Promise.allSettled(
      data.users.map((u) =>
        fetch(`/api/admin/users/${u.id}/permissions`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [fieldToApiKey(field)]: value }),
        }).catch((err) => logger.warn(err))
      )
    );
  } finally {
    setColumnBusy(null);
    queryClient.invalidateQueries(['admin', 'groups', numericId, 'detail']);
  }
}
```

Use a `columnBusy` state (`useState<PermField | null>(null)`) to track which column is updating.

**3. `ColumnTriToggle` component**:
```typescript
function ColumnTriToggle({ state, onClick, busy }: { state: TriState; onClick: () => void; busy: boolean }) {
  const glyph = state === 'all-on' ? '☑' : state === 'all-off' ? '☒' : '☐';
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{ background: 'none', border: 'none', cursor: busy ? 'default' : 'pointer', fontSize: 14 }}
      title={state === 'all-on' ? 'All on — click to turn all off' : 'Click to turn all on'}
    >
      {glyph}
    </button>
  );
}
```

**4. Wire into column headers**: In the `<thead>` of the member table, for each of the three permission columns (`<th>` currently labeled "OAuth", "LLM Proxy", "Lg Acct"), add `<ColumnTriToggle>` next to the label:
```tsx
<th>
  OAuth
  <ColumnTriToggle
    state={triState('allowsOauthClient', data.users)}
    onClick={() => {
      const current = triState('allowsOauthClient', data.users);
      bulkSetPermission('allowsOauthClient', current !== 'all-on');
    }}
    busy={columnBusy === 'allowsOauthClient'}
  />
  {columnBusy === 'allowsOauthClient' && <span style={{ fontSize: 11 }}> Updating...</span>}
</th>
```
Repeat for `allowsLlmProxy` and `allowsLeagueAccount`.

Map `PermField` to API key via a helper: `{ allowsOauthClient: 'allows_oauth_client', allowsLlmProxy: 'allows_llm_proxy', allowsLeagueAccount: 'allows_league_account' }`.

### Files to Modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — add component, helpers, state, and wired column headers

### Testing Plan

In `tests/client/pages/GroupDetailPanel.test.tsx`:

- **Visual state — mixed**: render with a fixture where some users have `allowsOauthClient: true` and some have `false`. Assert the OAuth column header toggle shows the mixed glyph (☐).
- **Visual state — all-on**: render with all users having `allowsLlmProxy: true`. Assert LLM Proxy header toggle shows ☑.
- **Visual state — all-off**: render with all users having `allowsLeagueAccount: false`. Assert League Account header shows ☒.
- **Click all-on → turn off**: mock PATCH endpoint. Simulate click on a ☑ toggle. Assert N PATCH calls each with `allows_oauth_client: false`.
- **Click all-off → turn on**: simulate click on a ☒ toggle. Assert N PATCH calls each with `allows_oauth_client: true`.
- **In-flight indicator**: stub PATCH as a pending promise. Assert "Updating..." text is present while in-flight.
- **Query invalidated**: assert `queryClient.invalidateQueries` is called after PATCHes settle.

Run: `npm run test:client -- GroupDetailPanel`
