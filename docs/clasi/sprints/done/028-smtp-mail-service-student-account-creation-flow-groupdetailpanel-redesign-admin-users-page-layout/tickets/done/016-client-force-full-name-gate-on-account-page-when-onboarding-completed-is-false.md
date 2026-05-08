---
id: '016'
title: 'Client: force-full-name gate on Account page when onboarding_completed is
  false'
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client: force-full-name gate on Account page when onboarding_completed is false

## Description

When a newly-registered external-identity student (onboarding_completed === false)
visits /account, they see only a "Complete your profile" form (full name + email
fields, pre-filled with existing values). The rest of the Account page is hidden
until they submit. On success the page re-renders normally.

## Acceptance Criteria

- [x] GET /api/account profile response includes `onboarding_completed` field (added to server route body).
- [x] `AccountProfile` interface has `onboarding_completed?: boolean`.
- [x] When `data.profile.onboarding_completed === false`, Account renders `CompleteProfileSection` instead of normal sections (page header + user dropdown remain).
- [x] `CompleteProfileSection` has full-name and email fields pre-filled with current values.
- [x] Submit POSTs `{ displayName, email }` to `/api/account/complete-onboarding`.
- [x] On success, `['account']` query is invalidated; page re-renders normally.
- [x] Client-side validation: empty name shows error without POSTing; empty email shows error without POSTing.
- [x] API errors are shown inline.
- [x] Tests cover: gate hides normal sections; fields pre-filled; correct POST body; success unblocks page; validation errors; API error surface; page header visible during gate.

## Testing

- **Existing tests to run**: `npm run test:client -- Account` (44 pre-existing tests all pass)
- **New tests to write**: 8 new tests in `tests/client/pages/Account.test.tsx` under "Account page — onboarding gate (CompleteProfileSection)"
- **Verification command**: `npm run test:client -- Account`
