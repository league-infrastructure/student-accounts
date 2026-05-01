---
id: 009
title: "Manual smoke pass \u2014 stakeholder verification sweep"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
depends-on:
- '007'
- 008
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 009 — Manual smoke pass: stakeholder verification sweep

## Description

Before the sprint is closed, the stakeholder performs a manual browser sweep confirming every flow works end-to-end. This ticket is the sprint's final gate. The executor should run the automated checks and confirm green before handing off to the stakeholder; the stakeholder then checks each item below and marks the ticket done.

**Executor steps** (before stakeholder testing):

1. Run `npm run test:server` — all suites green.
2. Run `npm run test:client` — all suites green.
3. Run `npx tsc --noEmit` in `client/` — no new errors.
4. Run `npx tsc --noEmit` in `server/` — no new errors beyond the pre-existing 25.
5. Start the dev server. Confirm it boots without errors.
6. Hand off to stakeholder.

## Acceptance Criteria

### Automated checks (executor)

- [ ] `npm run test:server` passes — all new suites green; existing baseline unchanged.
- [ ] `npm run test:client` passes — existing baseline unchanged; new suites green.
- [ ] `npx tsc --noEmit` in `client/` — no new errors.
- [ ] `npx tsc --noEmit` in `server/` — no new errors beyond pre-existing 25.
- [ ] Dev server starts cleanly.

### Manual browser verification (stakeholder)

- [ ] **Admin — create passphrase (cohort)**: Open `/cohorts/:id` as admin. "Create passphrase" button is visible. Clicking it opens the modal with a pre-filled passphrase. Clicking "Create" saves it and the card appears showing plaintext, TTL countdown, Copy, Regenerate, Revoke.
- [ ] **Admin — create passphrase (group)**: Same flow on `/groups/:id`. Card appears under header/toolbar.
- [ ] **TTL countdown**: TTL counts down in real time. When it hits zero the card flips back to the "Create passphrase" empty state (no page refresh needed).
- [ ] **Admin — rotate passphrase**: Click "Regenerate" on an active card. New passphrase saves; old passphrase is rejected at signup.
- [ ] **Admin — revoke passphrase**: Click "Revoke". Card returns to empty state.
- [ ] **Cohort signup — happy path**: Sign out. Open `/login`, expand "New student? Sign up with a class passphrase". Enter a username and a valid cohort passphrase. Submit. Land on `/account` with workspace account visible (or `workspace.provisioned=false` if workspace is unavailable in the test environment).
- [ ] **Group signup — happy path**: Same flow with a group passphrase. Land on `/account`. User appears in the group's member list. No workspace account shown.
- [ ] **LLM proxy at signup**: If `grantLlmProxy` was checked when the passphrase was created, the signed-up student's `/account` shows an active LLM proxy token.
- [ ] **Re-login after signup**: Sign out. Use the main login form with the same `username + passphrase` used at signup. Land on `/account`.
- [ ] **Wrong passphrase at login**: Use correct username but wrong passphrase. Inline "Invalid username or password" shown; no session set.
- [ ] **Expired passphrase at signup**: Wait for a passphrase to expire (or set `expires_at` to the past in the DB). Attempt signup → inline "Invalid or expired passphrase".
- [ ] **Revoked passphrase at signup**: After admin revokes → signup attempt → inline "Invalid or expired passphrase".
- [ ] **Username collision at signup**: Sign up as "testuser". Sign out. Try to sign up again as "testuser" with any valid passphrase → inline "That username is already taken".
