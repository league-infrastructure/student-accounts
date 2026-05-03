---
id: "007"
title: "Client: GroupDetailPanel permission toggles wired to PATCH endpoint"
status: todo
use-cases:
  - SUC-008
depends-on:
  - "005"
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: GroupDetailPanel permission toggles wired to PATCH endpoint

## Description

Add three permission toggle controls to `GroupDetailPanel.tsx` and wire them to
the `PATCH /admin/groups/:id` endpoint added in ticket 005.

The toggles display the current permission state (initialized from the `GET /admin/groups/:id`
response, which ticket 005 extends to include the three flags). Each toggle fires a PATCH
request with the single changed flag; the UI updates to reflect the server's response.

**Toggle labels and fields:**

| Label | API field |
|---|---|
| OAuth Client registration | `allowsOauthClient` |
| LLM Proxy access | `allowsLlmProxy` |
| League Account provisioning | `allowsLeagueAccount` |

**Caption** (for each toggle): "Toggling this on grants the capability to every member."

**UX note**: The `allowsLeagueAccount` toggle should indicate (via loading state or a
brief informational message) that toggling on may trigger background provisioning for
existing members.

## Acceptance Criteria

- [ ] Three toggle controls render in `GroupDetailPanel.tsx` in the group header area.
- [ ] Toggle initial state is loaded from `GET /admin/groups/:id` response fields `allowsOauthClient`, `allowsLlmProxy`, `allowsLeagueAccount`.
- [ ] Toggling any control fires `PATCH /admin/groups/:id` with the changed flag only.
- [ ] On a successful PATCH, the toggle reflects the value returned by the server.
- [ ] Caption "Toggling this on grants the capability to every member." appears for each toggle.
- [ ] `allowsLeagueAccount` toggle has a visible loading or pending indicator while the PATCH is in-flight (provisioning may take a moment).
- [ ] No other toggle or panel section re-renders unnecessarily on a permission toggle.
- [ ] Client unit tests cover: three toggles render with correct initial state; toggling fires PATCH with correct field; toggle reflects server response; loading state on leagueAccount toggle.
- [ ] All existing `GroupDetailPanel` tests continue to pass.

## Implementation Plan

### Approach

1. Update the `GroupInfo` interface in `GroupDetailPanel.tsx` to include the three
   permission fields returned by `GET /admin/groups/:id`.
2. Add three toggle state variables (or a single object) initialized from the query result.
3. Add a `patchPermission(field, value)` async function that calls
   `PATCH /admin/groups/:id` with `{ [field]: value }` and updates local state on success.
4. Render a "Permissions" section in the panel with three toggle rows.
5. Use the existing project toggle/switch component or a `<button>` with aria-pressed
   semantics (follow the project's existing pattern for boolean toggles — check
   `GroupDetailPanel.tsx` for existing toggle usage).
6. For `allowsLeagueAccount`, show a loading spinner or disable state while the PATCH
   is in-flight.

### Files to modify

- `client/src/pages/admin/GroupDetailPanel.tsx` — add permission section; extend
  GroupInfo type; add PATCH calls

### Files to create or modify

- `tests/client/pages/admin/GroupDetailPanel.test.tsx` — add permission toggle tests
  (or create if the file does not exist)

### Testing plan

Client unit tests (Vitest + RTL):
- Render panel with mock group data that has `allowsOauthClient=false`, `allowsLlmProxy=true`,
  `allowsLeagueAccount=false` → assert toggle states match.
- Simulate toggling `allowsOauthClient` → assert `PATCH` was called with `{ allowsOauthClient: true }`.
- Simulate toggling `allowsLlmProxy` (was true) → assert `PATCH` called with `{ allowsLlmProxy: false }`.
- Assert loading state appears when `allowsLeagueAccount` PATCH is in-flight.

### Documentation updates

None required.
