---
id: "002"
title: "POST /api/account/test-email endpoint"
status: todo
use-cases:
  - SUC-001
depends-on:
  - "001"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# POST /api/account/test-email endpoint

## Description

Add a server endpoint that lets an authenticated user send a one-off test email to one of
their own addresses to verify that SMTP is working. The endpoint validates address ownership,
gates on `MailService.isConfigured()`, calls `services.mail.send()`, and writes an audit event.

**Depends on ticket 001** — `MailService` and `ServiceRegistry.mail` must exist first.

## Acceptance Criteria

- [ ] `POST /api/account/test-email` is registered in the account routes and protected by `requireAuth`.
- [ ] If `to` is omitted: resolves the user's notification email from their profile (fallback: `primary_email`).
- [ ] If `to` is provided: validates that the address belongs to the user (primary, any login email, or any workspace `external_id`) — returns 400 if not.
- [ ] Returns 400 with a descriptive message when `services.mail.isConfigured()` is `false`.
- [ ] On success: returns 200 `{ ok: true, messageId: string, to: string }`.
- [ ] Audit event `account_test_email_sent` is written on success with `details: { to }`.
- [ ] Subject: `"League Accounts - test email"`. Body (text) includes the user's display name, the current timestamp, and an explanation that the email was triggered from the My Account page.
- [ ] Integration tests pass (see Testing Plan).

## Implementation Plan

### Approach

In `server/src/routes/account.ts` (or the relevant account routes file), add:

```
router.post('/test-email', requireAuth, async (req, res, next) => {
  try {
    const services = ServiceRegistry.create('UI');
    const { to: rawTo } = req.body as { to?: string };

    // 1. Resolve target address
    const user = await services.users.findById(req.session.userId);
    const resolved = rawTo ?? user.notificationEmail ?? user.primaryEmail;

    // 2. If caller-provided, validate ownership
    if (rawTo) {
      const owns = await ownsEmail(req.session.userId, rawTo, services);
      if (!owns) return res.status(400).json({ error: 'Address does not belong to this account' });
    }

    // 3. Gate on SMTP config
    if (!services.mail.isConfigured()) {
      return res.status(400).json({ error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD in .env.' });
    }

    // 4. Send
    const { messageId } = await services.mail.send({
      to: resolved,
      subject: 'League Accounts - test email',
      text: `Hi ${user.displayName ?? 'there'},\n\nThis is a test email sent from the My Account page at ${new Date().toISOString()}.\n\nIf you received this, your SMTP configuration is working correctly.`,
    });

    // 5. Audit
    await services.audit.record(prisma, { action: 'account_test_email_sent', actor_user_id: req.session.userId, details: { to: resolved } });

    res.json({ ok: true, messageId, to: resolved });
  } catch (err) {
    next(err);
  }
});
```

Reuse the `ownsEmail` helper (or equivalent ownership check) already used in `PATCH /api/account/profile` for `notificationEmail` validation. If that logic is not already extracted, extract it.

### Files to Modify

- `server/src/routes/account.ts` — add `POST /test-email` handler

### Testing Plan

Create or extend `tests/server/routes/account.test.ts`:
- Mock `ServiceRegistry.create` to return a services stub with `mail.isConfigured = () => true` and `mail.send = jest.fn().mockResolvedValue({ messageId: 'mid-123' })`.
- Test 200 success: omitting `to` uses notification email; response shape correct; `mail.send` called; audit written.
- Test 200 success: providing a valid owned `to` address is accepted.
- Test 400: `to` address not owned by user.
- Test 400: SMTP not configured (`isConfigured = () => false`).
- Test 401: unauthenticated request rejected.

Run: `npm run test:server -- account`
