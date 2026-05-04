---
id: 008
title: Manual smoke test
status: done
use-cases:
- SUC-007
depends-on:
- '007'
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke test

## Description

Validate the complete sprint 027 feature end-to-end in a running dev
environment. All automated tests should pass before this ticket is started.
The stakeholder or QA performs a manual walkthrough of the key flows.

## Acceptance Criteria

- [ ] All automated tests pass: `npm run test:server && npm run test:client`.
- [ ] Dev server starts without errors: `npm run dev`.
- [ ] Open a group that has at least two members. Three new columns are visible in the member grid: "OAuth", "LLM Proxy", "Lg Acct".
- [ ] The "Permissions" section is absent from the group detail page header.
- [ ] Check the "LLM Proxy" checkbox for one member. Verify the checkbox remains checked after page reload (flag persisted).
- [ ] Uncheck the "LLM Proxy" checkbox. Verify it unsets after reload.
- [ ] Check "League Account" for a member who has no Workspace ExternalAccount. Verify: (a) "Provisioning…" indicator appears briefly, (b) the member gains a `workspace` ExternalAccount in the database, (c) the checkbox stays checked.
- [ ] Uncheck "League Account". Verify the workspace ExternalAccount is NOT deleted.
- [ ] Confirm the OAuth client creation gate respects `allows_oauth_client`: use a non-admin user whose flag is false and verify the create attempt is rejected.
- [ ] `GET /api/admin/groups/:id` response does not include `allowsOauthClient`, `allowsLlmProxy`, or `allowsLeagueAccount`.

## Implementation Plan

### Approach

Run the dev server (`npm run dev`), log in as admin, and step through the
verification checklist manually. Use the browser dev tools Network tab to
confirm PATCH payloads and responses.

### Files to Modify

None — this is a read-only verification ticket.

### Testing Plan

The acceptance criteria above constitute the full test plan.

### Documentation Updates

None required.
