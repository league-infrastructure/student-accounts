---
id: '007'
title: "Manual smoke test \u2014 role walkthrough of new sidebar"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
depends-on:
- '001'
- '002'
- '003'
- '004'
- '005'
- '006'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke test — role walkthrough of new sidebar

## Description

Walk through the application in a running browser (dev or staging environment)
as three different users to verify the end-to-end sidebar behaviour. This
ticket is completed by the stakeholder (or a designated tester) and marked done
after a successful walkthrough.

## Pre-conditions

- `npm run dev` (or equivalent) is running with all sprint 021 changes applied.
- Three test accounts are available: one student, one staff, one admin.
- At least one student account has a `claude` ExternalAccount (active or
  pending) to verify Claude Code sidebar gating.
- At least one student account has `llmProxyEnabled: true` to verify LLM Proxy
  sidebar gating.

## Acceptance Criteria

### As a student (no entitlements)

- [ ] Sidebar shows: OAuth Clients, About.
- [ ] Sidebar does NOT show: Account, Services, User Management, Admin, Dashboard, Sync, Claude Code, LLM Proxy.
- [ ] Navigating to `/admin/env` directly does not change the sidebar.
- [ ] OAuth Clients page loads correctly at `/oauth-clients`.
- [ ] `/services` URL returns a Not Found page (no longer a route).

### As a student with Claude Code entitlement

- [ ] Sidebar shows: OAuth Clients, Claude Code, About.
- [ ] Claude Code page at `/claude-code` renders the install/auth/verify steps.

### As a student with LLM Proxy enabled

- [ ] Sidebar shows: OAuth Clients, LLM Proxy, About.
- [ ] LLM Proxy page at `/llm-proxy` renders the endpoint, token, and quota bar.

### As a student with a Workspace (league email) account

- [ ] Account page shows the Workspace block with League email.
- [ ] If `workspaceTempPassword` is set, the temp password is displayed inline.

### As a staff user

- [ ] Sidebar shows: OAuth Clients, User Management (collapsed), About.
- [ ] Clicking "User Management" expands the group AND navigates to `/staff/directory`.
- [ ] Group children visible: Staff Directory only (Users, Cohorts, Groups are admin-only — not shown).
- [ ] Navigating to `/admin/env` does not change the sidebar shape.

### As an admin user

- [ ] Sidebar shows: OAuth Clients, User Management (with all 6 children), Dashboard, Sync, Admin (with all 8 ops links), About.
- [ ] User Management children: Staff Directory, Users, League Students, LLM Proxy Users, Cohorts, Groups.
- [ ] Admin group children: Audit Log, Environment, Database, Configuration, Logs, Sessions, Scheduled Jobs, Import/Export.
- [ ] Navigating between `/admin/env`, `/cohorts`, `/users/students` — sidebar never changes shape.
- [ ] Clicking "Users" under User Management navigates to `/admin/users` (AdminUsersPanel).
- [ ] Navigating to `/users` directly redirects to `/admin/users`.
- [ ] User-menu dropdown (avatar click) shows Account and Log out — not in sidebar.

## Testing

- **Existing tests to run**: `npm run test:client` and `npm run test:server` should both pass before this ticket is marked done.
- **New tests to write**: None — this is a manual verification ticket.
- **Verification**: Stakeholder signs off by checking each box above and moving this ticket to done.
