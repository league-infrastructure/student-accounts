---
id: '001'
title: SMTP MailService + ServiceRegistry wiring
status: todo
use-cases:
  - SUC-001
  - SUC-002
depends-on: []
github-issue: ''
todo: smtp-mail-service-and-account-test-email-button.md
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# SMTP MailService + ServiceRegistry wiring

## Description

Introduce outbound email capability to the server. Create `server/src/services/mail.service.ts`
as a thin nodemailer wrapper that reads SMTP credentials from env vars and exposes `isConfigured()`
and `send()`. Register the service as `ServiceRegistry.mail`. This is the foundation required by
ticket 002 (test-email endpoint) and ticket 004 (provisioning welcome email).

The `.env` already carries Mandrill SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
`SMTP_PASSWORD`). Construction must never throw — if vars are absent the service logs a warning
and `isConfigured()` returns `false`.

## Acceptance Criteria

- [ ] `nodemailer` and `@types/nodemailer` are added to `server/package.json`.
- [ ] `MailService` class exists at `server/src/services/mail.service.ts`.
- [ ] Constructor reads `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`. Optionally `SMTP_SECURE` (default `false`) and `SMTP_FROM` (default first of `ADMIN_EMAILS`, fallback `SMTP_USERNAME`).
- [ ] `isConfigured(): boolean` returns `true` when all four required vars are set; `false` otherwise.
- [ ] `send({ to, subject, text, html? }): Promise<{ messageId: string }>` sends via nodemailer.
- [ ] `send()` throws `MailNotConfiguredError` (named subclass of `Error`) when `isConfigured()` is `false`.
- [ ] Construction with missing vars does not throw; logs a single `warn`.
- [ ] `ServiceRegistry` declares `readonly mail: MailService` and instantiates it in the private constructor.
- [ ] Server starts cleanly with zero SMTP env vars present.
- [ ] Unit tests pass (see Testing Plan).

## Implementation Plan

### Approach

1. In `server/`, run `npm install nodemailer` and `npm install --save-dev @types/nodemailer`.
2. Create `server/src/services/mail.service.ts`:
   - Constructor: read four env vars. If any missing, log `warn`, set `this.configured = false`. If all present, create `nodemailer.createTransport(...)` (host, port, secure, auth) and set `this.configured = true`.
   - `isConfigured()` returns `this.configured`.
   - `send()`: if not configured, throw `new MailNotConfiguredError(...)`. Otherwise `await this.transporter.sendMail({ from, to, subject, text, html })` and return `{ messageId: info.messageId }`.
   - Export `MailNotConfiguredError` class.
3. In `service.registry.ts`: import `MailService`; add `readonly mail: MailService` to the class; instantiate `this.mail = new MailService()` early in the constructor (before `workspaceProvisioning`, since WPS will receive it in ticket 004).

### Files to Create

- `server/src/services/mail.service.ts`

### Files to Modify

- `server/package.json` — `nodemailer` + `@types/nodemailer`
- `server/src/services/service.registry.ts` — `mail` property + instantiation

### Testing Plan

Create `tests/server/services/mail.service.test.ts`:
- Mock nodemailer: spy on `createTransport`; stub `sendMail` to resolve `{ messageId: 'test-id' }`.
- Test: `isConfigured()` true when all four vars set.
- Test: `isConfigured()` false when any var missing.
- Test: `send()` resolves `{ messageId: 'test-id' }` on mock transport success.
- Test: `send()` throws `MailNotConfiguredError` when `isConfigured()` is false.
- Test: construction does not throw when vars missing.

Run: `npm run test:server -- mail.service`

### Documentation Updates

None — `MailService` is an internal service.
