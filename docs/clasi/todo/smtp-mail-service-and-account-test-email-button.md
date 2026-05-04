---
status: pending
---

# SMTP outbound mail + "Send test email" button on Account page

Stakeholder direction captured 2026-05-03. Wire SMTP-backed
outbound mail using the existing `.env` Mandrill config and
surface a "Send test email" button on the My Account page next to
the notification-email picker.

## Context

`.env` already carries Mandrill SMTP credentials:
```
SMTP_HOST=smtp.mandrillapp.com
SMTP_PORT=587
SMTP_USERNAME='LeagueBot'
SMTP_PASSWORD=md-…
```

There is **no** outbound-mail code in the repo yet. This TODO
introduces it.

## Server work

### A. New MailService

`server/src/services/mail.service.ts` — thin wrapper around
`nodemailer`. Reads `SMTP_HOST / SMTP_PORT / SMTP_USERNAME /
SMTP_PASSWORD`. Optional `SMTP_SECURE` (default false; 587 uses
STARTTLS automatically) and `SMTP_FROM` (default: first entry of
`ADMIN_EMAILS`, fallback to `SMTP_USERNAME`).

Public surface:
- `isConfigured(): boolean` — true when all four required env
  vars are set.
- `send({ to, subject, text, html? }): Promise<{ messageId }>`.
- `MailNotConfiguredError` thrown when not configured.

Add `nodemailer` + `@types/nodemailer` to `server/package.json`.

### B. Register in ServiceRegistry

`readonly mail: MailService` on the registry, instantiated in the
private constructor. Construction never throws; if env is missing,
the service logs a warning and `isConfigured()` returns false.

### C. New endpoint: `POST /api/account/test-email`

Body: `{ to?: string }`. If `to` is omitted, use the user's
notification email (or primary if unset). If `to` is provided,
**validate it belongs to the user** using the same ownership
check as `PATCH /api/account/profile`'s `notificationEmail`
validation (primary, any login email, any workspace external_id).

Behavior:
- 400 when SMTP not configured (with helpful "set SMTP_* in .env")
- 400 when `to` doesn't belong to the user
- 200 with `{ ok: true, messageId, to }` on success

Subject: `League Accounts — test email`. Body (text): name,
timestamp, and a one-liner explaining this was triggered from the
My Account page. Audit-event: `account_test_email_sent` with
target email.

## Client work

### D. "Send test email" button on Account page

Right next to the notification-email picker in `ProfileSection`
(or just below it). Disabled while in flight; shows a small
"Sent ✓" or "Failed: <reason>" pill for ~5s after the call
returns.

Recommended UX:
- Button label: `Send test`
- On click: `POST /api/account/test-email` with the currently
  selected notification email (server validates ownership again).
- Success: small green pill "Test email sent to <addr>".
- Error: small red pill with the server's error message.

## Stakeholder clarifications still needed

1. **Send target:** the notification email currently selected in
   the picker, or always the primary email? Default assumption:
   the currently-selected notification email.
2. **Subject / body content:** generic test message OK, or do we
   need branded copy?

## Out of scope

- Wiring outbound mail to other call sites (welcome email,
  password reset, etc.) — this TODO only lays the foundation.
- Email templates / Markdown body rendering.
- Bounce / delivery-failure tracking beyond what nodemailer
  surfaces synchronously.
- Rate limiting on the test-email endpoint (could be a follow-up
  if abuse becomes a concern).

## Suggested ticket shape

1. Add `nodemailer` + `@types/nodemailer`; create `MailService`;
   register in `ServiceRegistry`. Unit test (mock the transport)
   asserting `isConfigured()` semantics and `send()` happy path.
2. Add `POST /api/account/test-email` endpoint with ownership
   validation + audit event. Integration test mocking
   `services.mail.send`.
3. Add Send-test button to `ProfileSection` in `Account.tsx` with
   inline status pill. Test asserting click triggers the right
   POST and pill renders on success/failure.
4. Manual smoke: send a test from the Account page; verify the
   email lands; verify the audit event was written.
