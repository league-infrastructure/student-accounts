---
status: draft
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 028 Use Cases

## SUC-001: Configure and verify outbound SMTP mail

- **Actor**: System administrator
- **Preconditions**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` are set in `.env`.
- **Main Flow**:
  1. Administrator opens the My Account page.
  2. Administrator clicks "Send test" next to the notification-email picker.
  3. The client POSTs to `/api/account/test-email` with the currently selected notification email.
  4. The server validates ownership of the target address.
  5. `MailService.send()` transmits the message via SMTP/STARTTLS.
  6. The server returns `{ ok: true, messageId, to }`.
  7. A green "Test email sent to <addr>" pill appears for ~5 s.
  8. Audit event `account_test_email_sent` is written.
- **Postconditions**: The test email lands in the target inbox; the audit log contains the event.
- **Acceptance Criteria**:
  - [ ] `MailService.isConfigured()` returns `true` when all four SMTP vars are present.
  - [ ] `POST /api/account/test-email` returns 200 with `{ ok, messageId, to }` on success.
  - [ ] Returns 400 with "SMTP not configured" when vars are absent.
  - [ ] Returns 400 when `to` address does not belong to the authenticated user.
  - [ ] Audit event is recorded on success.
  - [ ] Client pill shows success/failure message for ~5 s then clears.

---

## SUC-002: MailService construction never blocks startup

- **Actor**: Application runtime
- **Preconditions**: `ServiceRegistry.create()` is called at server startup.
- **Main Flow**:
  1. `ServiceRegistry` private constructor instantiates `MailService`.
  2. `MailService` reads env vars; if any are missing, it logs a warning and sets `isConfigured() = false`.
  3. Server starts normally regardless of SMTP configuration state.
- **Postconditions**: Server is available; `services.mail.isConfigured()` reflects env state.
- **Acceptance Criteria**:
  - [ ] Server starts with zero SMTP env vars without throwing.
  - [ ] `services.mail.isConfigured()` returns `false` when vars are missing.
  - [ ] `services.mail.send()` throws `MailNotConfiguredError` when not configured.

---

## SUC-003: Student Workspace account lands in /Students OU

- **Actor**: Admin (via permission toggle or Create League button)
- **Preconditions**: Student user exists; `allows_league_account` toggled to `true` (or admin triggers provision directly).
- **Main Flow**:
  1. `provisionUserIfNeeded` is called with the student's userId.
  2. `WorkspaceProvisioningService.provision()` is invoked inside a transaction.
  3. The service derives the workspace email from `GOOGLE_STUDENT_DOMAIN`.
  4. Google Admin `users.insert` is called with `orgUnitPath: '/Students'` (no cohort lookup).
  5. `changePasswordAtNextLogin: true` is set.
  6. `password` field is set from `GOOGLE_WORKSPACE_TEMP_PASSWORD`.
  7. `ExternalAccount` row is written; audit event recorded.
- **Postconditions**: Google Workspace account exists in `/Students`; `ExternalAccount` row is active.
- **Acceptance Criteria**:
  - [ ] `users.insert` payload contains `orgUnitPath: '/Students'`.
  - [ ] No cohort id or cohort OU path is referenced in the payload.
  - [ ] `changePasswordAtNextLogin: true` in the payload.
  - [ ] `password` equals `GOOGLE_WORKSPACE_TEMP_PASSWORD`.
  - [ ] `User.cohort_id` is not modified by the provisioning call.

---

## SUC-004: New student receives a welcome email with temp password

- **Actor**: Application (post-provisioning side-effect)
- **Preconditions**: Workspace account just created successfully; student has a notification email (or primary email as fallback); `MailService.isConfigured()` is `true`.
- **Main Flow**:
  1. After `googleClient.createUser` succeeds, `WorkspaceProvisioningService` calls `MailService.send()`.
  2. The `to` address is the student's notification email (fallback: `primary_email`).
  3. The body includes the new League email address and the default password, plus a note about first-login password change.
- **Postconditions**: Welcome email delivered to the student's personal inbox.
- **Acceptance Criteria**:
  - [ ] `MailService.send()` is called once with `to` = notification email (or primary).
  - [ ] Email body contains the student's new League email address.
  - [ ] Email body contains the default temp password.
  - [ ] Email body mentions that the password must be changed on first login.
  - [ ] Provisioning succeeds even if `MailService.send()` throws (fail-soft on email).

---

## SUC-005: GroupDetailPanel title row contains group name and Delete button

- **Actor**: Admin
- **Preconditions**: Admin navigates to `/groups/:id`.
- **Main Flow**:
  1. Page loads with group name on the left of a flex title row.
  2. "Delete Group" button is on the far right of the same row.
  3. Description and member count appear below the title row.
- **Postconditions**: Layout matches spec; Delete is reachable without scrolling.
- **Acceptance Criteria**:
  - [ ] Delete button is rendered inside the same flex row as the group name h2.
  - [ ] Delete button has `justify-content: space-between` context (right-aligned).
  - [ ] No separate row below the description renders Delete.

---

## SUC-006: PassphraseCard appears immediately below the title/description block

- **Actor**: Admin
- **Preconditions**: Group has an existing passphrase (or passphrase is `null` and card shows "Generate" CTA).
- **Main Flow**:
  1. Admin opens group detail page.
  2. `PassphraseCard` renders directly below the description paragraph, before any other section.
  3. Card shows the current passphrase value and a Regenerate button.
- **Postconditions**: Passphrase is the first actionable item visible after the group header.
- **Acceptance Criteria**:
  - [ ] `PassphraseCard` renders before the member table and before any toolbar.
  - [ ] No bulk-action toolbar or selection UI appears between the header and the card.

---

## SUC-007: Bulk-action toolbar and GrantLlmProxyModal are removed

- **Actor**: Admin
- **Preconditions**: Admin opens group detail page.
- **Main Flow**:
  1. Page loads without the five bulk-action buttons (Create League, Remove League, Suspend, Grant LLM Proxy, Revoke LLM Proxy).
  2. No row-level selection checkbox column appears in the member table.
  3. `GrantLlmProxyModal` import and render are gone.
- **Postconditions**: Page is leaner; bulk operations are performed via column tri-state toggles.
- **Acceptance Criteria**:
  - [ ] No `runBulkProvision`, `runBulkAll`, `runBulkLlmProxyRevoke` handlers remain.
  - [ ] No `selectedIds` state variable remains.
  - [ ] No per-row "Select" checkbox `<td>` column remains.
  - [ ] `GrantLlmProxyModal` import is absent.
  - [ ] Existing tests for deleted buttons are removed; suite still passes.

---

## SUC-008: Column-header tri-state toggles apply bulk permission changes

- **Actor**: Admin
- **Preconditions**: Group has members with mixed permission states across OAuth Client, LLM Proxy, and League Account columns.
- **Main Flow**:
  1. Page renders; each column header shows ☐ (mixed), ☑ (all on), or ☒ (all off) based on live row data.
  2. Admin clicks ☑ header: all members receive `PATCH /api/admin/users/:id/permissions` with `allows_X: false`; header flips to ☒.
  3. Admin clicks ☒ or ☐ header: all members receive PATCH with `allows_X: true`; header flips to ☑.
  4. A "Updating column…" indicator appears while PATCHes are in flight.
  5. Group detail query is invalidated after all PATCHes complete.
- **Postconditions**: All member rows reflect the new permission value; server state matches.
- **Acceptance Criteria**:
  - [ ] `ColumnTriToggle` renders one of three states derived purely from row data (no extra state).
  - [ ] Click from all-on issues N PATCHes with `allows_X: false`.
  - [ ] Click from all-off or mixed issues N PATCHes with `allows_X: true`.
  - [ ] In-flight "Updating…" indicator is visible while PATCHes are outstanding.
  - [ ] No new server endpoint is added; per-user PATCH is reused.

---

## SUC-009: Admin users page renders without section boxes; action buttons are right-aligned

- **Actor**: Admin
- **Preconditions**: Admin navigates to `/admin/users`.
- **Main Flow**:
  1. Page renders.
  2. Section content appears without bordered/carded wrappers.
  3. The user-record header (name + email) remains visually distinct.
  4. Action buttons (add/revoke access) appear right-aligned within their section row.
- **Postconditions**: Page is visually flatter and cleaner.
- **Acceptance Criteria**:
  - [ ] No section-level `border` or card-style `box-shadow` containers wrap content sections.
  - [ ] The header block retains its visual distinction (background or typography, not a box border).
  - [ ] Action buttons are positioned to the right side of their section (flex `justify-content: flex-end` or equivalent).
  - [ ] All existing filtering and sorting functionality still works.
