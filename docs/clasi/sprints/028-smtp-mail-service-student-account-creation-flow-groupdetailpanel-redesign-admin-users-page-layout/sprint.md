---
id: "028"
title: "SMTP mail service - student account creation flow - GroupDetailPanel redesign - admin users page layout"
status: planning
branch: sprint/028-smtp-mail-service-student-account-creation-flow-groupdetailpanel-redesign-admin-users-page-layout
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
  - SUC-006
  - SUC-007
  - SUC-008
  - SUC-009
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 028: SMTP mail service - student account creation flow - GroupDetailPanel redesign - admin users page layout

## Goals

1. Introduce a `MailService` backed by the existing Mandrill/SMTP credentials and wire it into `ServiceRegistry`. Surface a "Send test email" button on the My Account page so admins can verify outbound mail is working.
2. Audit and complete the student Workspace account creation flow: fix the OU path to always use `/Students`, drop cohort-derived OU logic, set the temp password from `GOOGLE_WORKSPACE_TEMP_PASSWORD`, force password-change on first login, and send a welcome email via `MailService`.
3. Redesign `GroupDetailPanel`: move Delete to the title row, hoist `PassphraseCard` above all other sections, drop the bulk-action toolbar and selection column, and add tri-state column-header toggles for the three permission columns.
4. Streamline the admin users page layout: remove section boxes for a flatter visual, keep the header visually distinct, and right-align action buttons.

## Problem

- No outbound email capability exists; welcome-email and test-email features require it.
- The Workspace provisioning flow still references cohort OU paths and does not set a temp password or force-change-password flag, leaving newly created student accounts in an incomplete state.
- The `GroupDetailPanel` bulk-action toolbar is redundant now that per-user permission toggles exist; the passphrase card is buried below bulk buttons; Delete is not in the header row.
- The admin users page has excessive visual boxing around sections and action buttons appear below sections rather than inline.

## Solution

- `MailService` (nodemailer thin wrapper) + `ServiceRegistry.mail` + `POST /api/account/test-email` endpoint + client button.
- Extend `WorkspaceProvisioningService.provision()` to use `/Students` OU (no cohort lookup), set `password` from `GOOGLE_WORKSPACE_TEMP_PASSWORD`, set `changePasswordAtNextLogin: true`, and call `MailService.send()` for a welcome email post-creation.
- Restructure `GroupDetailPanel` layout per TODO spec: flex title row with Delete right-aligned; `PassphraseCard` immediately below; bulk toolbar block deleted along with `GrantLlmProxyModal`, `selectedIds` state, and per-row select column; `ColumnTriToggle` component with per-column PATCH loop.
- Remove section-border containers from `AdminUsersPanel`, right-align action buttons, keep header distinct.

## Success Criteria

- A test email can be sent from the My Account page and lands in the target inbox; audit event written.
- Creating a student Workspace account sets OU to `/Students`, temp password matches env var, `changePasswordAtNextLogin: true`, and a welcome email is sent to the student's notification address.
- `GroupDetailPanel` loads with Delete in the title bar, passphrase above all other content, no bulk-action buttons, and tri-state column toggles that batch-PATCH all members.
- Admin users page renders without section boxes; action buttons are right-aligned.
- All affected test suites pass (server + client).

## Scope

### In Scope

- `MailService` + `ServiceRegistry` wiring + `POST /api/account/test-email`.
- Client "Send test" button on `Account.tsx / ProfileSection`.
- `WorkspaceProvisioningService.provision()` overhaul: `/Students` OU, temp password, force-change, welcome email.
- Integration test for the end-to-end provisioning path.
- `GroupDetailPanel` title-bar + Delete relayout.
- `GroupDetailPanel` PassphraseCard hoist.
- `GroupDetailPanel` bulk-toolbar + GrantLlmProxyModal + selection column deletion.
- `GroupDetailPanel` `ColumnTriToggle` component + `bulkSetPermission` loop.
- `AdminUsersPanel` layout streamlining.
- Manual smoke test ticket.

### Out of Scope

- Email templates / Markdown body rendering.
- Bounce / delivery-failure tracking.
- Rate-limiting on the test-email endpoint.
- Self-service password reset flow.
- Server-side bulk-permission endpoint (reuse per-user PATCH).
- Consolidated `bulk_permission_set` audit event.
- Redesigning per-row checkboxes in the member table.

## Test Strategy

- Unit test `MailService`: mock nodemailer transport; assert `isConfigured()` semantics and `send()` happy path.
- Integration test `POST /api/account/test-email`: mock `services.mail.send`; assert ownership validation, 400 on missing config, 200 on success.
- Integration test `WorkspaceProvisioningService.provision()`: mock Google Admin client and `MailService`; assert OU, password, `changePasswordAtNextLogin`, and `MailService.send` call.
- Client tests for "Send test" button: assert PATCH fires on click, pill renders on success/failure.
- Client tests for `GroupDetailPanel`: drop old bulk-button assertions; add tri-state visual state tests; add click-toggle tests asserting N PATCH calls; assert Delete in title row.
- Client tests for `AdminUsersPanel`: assert no section border containers; assert button right-alignment.

## Source TODOs

- `smtp-mail-service-and-account-test-email-button.md`
- `verify-and-finish-student-account-creation-flow.md` (depends on SMTP TODO)
- `groupdetailpanel-redesign-passphrase-up-top-drop-bulk-buttons-tri-state-column-toggles.md`
- `streamline-admin-users-page-layout.md`

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | SMTP MailService + ServiceRegistry wiring | — | 1 |
| 002 | POST /api/account/test-email endpoint | 001 | 2 |
| 003 | Client "Send test" button on Account page | 002 | 3 |
| 004 | Student account creation flow audit + welcome email + force-change-password | 001 | 2 |
| 005 | GroupDetailPanel — move Delete to title bar + hoist PassphraseCard | — | 1 |
| 006 | GroupDetailPanel — drop bulk-action toolbar + selection column + GrantLlmProxyModal | 005 | 2 |
| 007 | GroupDetailPanel — tri-state column toggles wired to per-user PATCH loop | 006 | 3 |
| 008 | Streamline admin users page layout | — | 1 |
| 009 | Manual smoke test | 003, 004, 007, 008 | 4 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
