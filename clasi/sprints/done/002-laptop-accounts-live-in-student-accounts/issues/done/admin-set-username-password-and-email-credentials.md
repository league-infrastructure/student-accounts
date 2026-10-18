---
status: done
sprint: '002'
tickets:
- 002-005
---

# Admin: set a student's username and password, and email them their credentials

## Context

From the administrator's view of a student (`client/src/pages/admin/UserDetailPanel.tsx`)
there is no way to set the student's username or password, and no way to
send credentials to the student at an address of the admin's choosing.
With laptop logins now managed here (username + password pushed to the
roster), this is the minimum an instructor needs at the start of a class:
set the username, set or generate a password, email both to the student
(or a parent).

## Scope

- Admin "Credentials" card on the user detail panel: username (editable
  with validation), password (type one or generate one), "Email
  credentials to…" with an editable address.
- Server endpoints with audit events.
- Credentials email template.

## Design

**Endpoints** (admin only, `server/src/routes/admin/users.ts` or a new
`routes/admin/credentials.ts`):

- `PUT /api/admin/users/:id/credentials` body `{username?, password?,
  generatePassword?: boolean}` → `{username, password?: <plaintext only
  when generated or set in this call>}`. Reuses `UserService` username
  validation (including the laptop rules from the write-back issue when
  `allows_laptop_account`), `hashPassword` for scrypt, `makeCryptHash` for
  `laptop_password_hash`, and triggers `LaptopAccountService.reconcile`.
  Creates the `username` Login row if the user has none (same shape as
  `PATCH /api/account/credentials`). Audit `admin_set_username`,
  `admin_set_password` (never the password).
- `POST /api/admin/users/:id/credentials/email` body `{to, password?,
  message?}` → sends the email via `mail.service.ts` and audits
  `credentials_emailed` with the recipient address. The password is
  included only if supplied in this request (it is never readable later);
  the UI passes the one it just set/generated. `to` defaults to the user's
  `notification_email ?? primary_email` but is free text; refuse
  `*.invalid`.

**Generated passwords.** Three lowercase words from a small wordlist
joined by `-` (e.g. `maple-robot-seven`), easy to type on a laptop login
screen; 4+ chars minimum when typed by the admin.

**Email** (new template in `mail.service.ts`): subject "Your League
account", body with the username, the password if present, where to log
in (this site's URL) and, when the user has a laptop account, the sentence
about choosing Other... on a League laptop. Plain text plus the existing
HTML wrapper.

**UI** (`UserDetailPanel.tsx`, new `UserCredentialsCard.tsx`): username
field with Save; password section with "Set password" (typed) and
"Generate" (shows the generated password once with Copy); "Email
credentials" button opening a small dialog: To (prefilled, editable),
include password (checked when one was just set), optional note, Send.
Success/failure toasts; the password is cleared from the component state
after sending or on navigation.

**Account page.** If the admin set a password, the student sees nothing
different; the existing change-password flow still works.

## Files

- `server/src/routes/admin/credentials.ts` (new) mounted in `app.ts`;
  `server/src/services/user.service.ts` (`setCredentialsByAdmin`),
  `server/src/services/mail.service.ts` (template),
  `server/src/utils/password.ts` (`generatePassword`)
- `client/src/pages/admin/UserCredentialsCard.tsx` (new),
  `UserDetailPanel.tsx`
- Tests: `tests/server/routes/admin/credentials.test.ts` (403 for
  non-admins; set username validation; set password then login works;
  generated password returned once; email endpoint calls the mail
  service with the right fields and refuses `.invalid`); client test for
  the card (pattern `tests/client/AdminUsersPanel.test.tsx`).

## Verification

1. Admin sets username `alice` and generates a password; the student can
   sign in with them at `/api/auth/login`; audit shows both events
   without the password.
2. Admin emails credentials to `parent@example.com`; the fake mail
   transport receives username + password; audit records the address.
3. Username `Student` rejected with the laptop rule message when the flag
   is on.
4. With the write-back issue in place, setting the password updates the
   roster entry.

## Dependencies

- Write-back issue for `laptop_password_hash` / reconcile (the card works
  without it; the hook is a one-liner once it exists).
