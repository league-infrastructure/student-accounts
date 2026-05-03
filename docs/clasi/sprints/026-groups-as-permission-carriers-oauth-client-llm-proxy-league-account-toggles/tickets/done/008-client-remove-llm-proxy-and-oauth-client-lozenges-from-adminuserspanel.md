---
id: 008
title: 'Client: Remove LLM Proxy and OAuth Client lozenges from AdminUsersPanel'
status: done
use-cases:
- SUC-009
depends-on: []
github-issue: ''
todo: ''
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: Remove LLM Proxy and OAuth Client lozenges from AdminUsersPanel

## Description

Remove the "LLM Proxy" and "OAuth Client" feature lozenges from the `AdminUsersPanel`
feature lozenge bar. These lozenges were added in Sprint 025 to filter users by
per-user capability. As of Sprint 026, that capability is managed at the group level
(not user level), so these lozenges are no longer meaningful as filters.

After this ticket, the feature lozenge bar has three pills: `Google | Pike 13 | GitHub`.
The role lozenge bar is unchanged.

The `llmProxyEnabled` and `oauthClientCount` fields remain in the API response (they
do not need to be stripped from the server); only the client-side filter UI and predicates
are removed.

## Acceptance Criteria

- [x] `AdminUsersPanel.tsx` feature lozenge bar renders only: `Google`, `Pike 13`, `GitHub`.
- [x] No "LLM Proxy" lozenge renders.
- [x] No "OAuth Client" lozenge renders.
- [x] The `FeatureFilter` type no longer includes `'llm-proxy'` or `'oauth-client'`.
- [x] The client-side filter predicate logic for `llmProxyEnabled` and `oauthClientCount` is removed.
- [x] Existing `Google`, `Pike 13`, and `GitHub` lozenges continue to function correctly.
- [x] Client unit tests (`npm run test:client`) pass.
- [x] New test asserts the absence of the two removed lozenges.
- [x] Any existing tests that assert on the presence of `LLM Proxy` or `OAuth Client` lozenges are updated.

## Implementation Plan

### Approach

1. In `client/src/pages/admin/AdminUsersPanel.tsx`:
   - Remove `'llm-proxy'` and `'oauth-client'` from the `FeatureFilter` type union.
   - Remove the lozenge button renders for those two values from the feature lozenge bar.
   - Remove or comment out the filter predicate functions: `llmProxyEnabled === true`
     and `oauthClientCount > 0`.
   - Optionally remove `llmProxyEnabled` and `oauthClientCount` from the `AdminUser`
     interface (they will still be in the API response but the client no longer uses them
     for filtering; removing them avoids dead code).

2. Update `tests/client/pages/admin/AdminUsersPanel.test.tsx`:
   - Remove any assertions that test the presence or behavior of LLM Proxy or OAuth
     Client lozenges.
   - Add assertions that the two lozenges are absent from the rendered output.

### Files to modify

- `client/src/pages/admin/AdminUsersPanel.tsx` — remove lozenges and filter predicates
- `tests/client/pages/admin/AdminUsersPanel.test.tsx` — update tests

### Testing plan

Client unit tests (Vitest + RTL):
- Render `AdminUsersPanel` with mock user data → assert no element with text "LLM Proxy".
- Render `AdminUsersPanel` with mock user data → assert no element with text "OAuth Client".
- Assert feature lozenge bar has exactly three items: Google, Pike 13, GitHub.

### Documentation updates

None required.
