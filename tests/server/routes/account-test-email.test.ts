/**
 * Integration tests for POST /api/account/test-email (Sprint 028 T002).
 *
 * Swaps `registry.mail` with a fake so no real SMTP connection is made.
 * All other services (users, logins, externalAccounts, audit) use the real
 * SQLite test database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';

// ---------------------------------------------------------------------------
// Fake mail service
// ---------------------------------------------------------------------------

const fakeSend = vi.fn().mockResolvedValue({ messageId: 'mid-test-001' });
const fakeMail = {
  isConfigured: vi.fn().mockReturnValue(true),
  send: fakeSend,
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Open a supertest agent authenticated as the given email/role.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'student',
  displayName = 'Test User',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/test-login')
    .send({ email, displayName, role })
    .expect(200);
  return agent;
}

// ---------------------------------------------------------------------------
// Lifecycle — swap registry.mail for all tests in this file
// ---------------------------------------------------------------------------

let originalMail: typeof registry.mail;

beforeEach(async () => {
  await cleanDb();
  originalMail = registry.mail;
  (registry as any).mail = fakeMail;
  fakeMail.isConfigured.mockReturnValue(true);
  fakeSend.mockReset();
  fakeSend.mockResolvedValue({ messageId: 'mid-test-001' });
});

afterEach(async () => {
  (registry as any).mail = originalMail;
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Unauthenticated
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — unauthenticated', () => {
  it('returns 401 when no session is present', async () => {
    const res = await request(app).post('/api/account/test-email').send({});
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SMTP not configured
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — SMTP not configured', () => {
  it('returns 400 with a descriptive error when isConfigured() is false', async () => {
    fakeMail.isConfigured.mockReturnValue(false);
    const agent = await loginAs('smtp-off@example.com', 'student', 'SMTP Off');
    const res = await agent.post('/api/account/test-email').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SMTP not configured/i);
    expect(fakeSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// `to` not owned by user
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — address not owned', () => {
  it('returns 400 when `to` is an address that does not belong to the user', async () => {
    const agent = await loginAs('owner@example.com', 'student', 'Owner');
    const res = await agent
      .post('/api/account/test-email')
      .send({ to: 'stranger@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not belong/i);
    expect(fakeSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Success — `to` omitted: uses notification_email
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — success, to omitted', () => {
  it('uses notification_email when `to` is omitted and notification_email is set', async () => {
    // Create user via test-login, then set notification_email directly.
    const agent = await loginAs('notif@example.com', 'student', 'Notif User');

    // Set notification_email via the profile PATCH.
    const patchRes = await agent
      .patch('/api/account/profile')
      .send({ notificationEmail: 'notif@example.com' });
    expect(patchRes.status).toBe(200);

    const res = await agent.post('/api/account/test-email').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.to).toBe('notif@example.com');
    expect(typeof res.body.messageId).toBe('string');
    expect(fakeSend).toHaveBeenCalledOnce();
    const call = fakeSend.mock.calls[0][0] as any;
    expect(call.to).toBe('notif@example.com');
    expect(call.subject).toBe('League Accounts - test email');
    expect(call.text).toContain('My Account page');
  });

  it('falls back to primary_email when notification_email is null', async () => {
    const agent = await loginAs('primary-fallback@example.com', 'student', 'Primary User');

    const res = await agent.post('/api/account/test-email').send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.to).toBe('primary-fallback@example.com');
    expect(fakeSend).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Success — valid owned `to` provided
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — success, owned `to` provided', () => {
  it('accepts primary_email as the `to` address', async () => {
    const agent = await loginAs('me@example.com', 'student', 'Me User');

    const res = await agent
      .post('/api/account/test-email')
      .send({ to: 'me@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.to).toBe('me@example.com');
    expect(fakeSend).toHaveBeenCalledOnce();
  });

  it('accepts ownership check case-insensitively', async () => {
    const agent = await loginAs('case@example.com', 'student', 'Case User');

    // Send with uppercase — ownership check should be case-insensitive.
    const res = await agent
      .post('/api/account/test-email')
      .send({ to: 'CASE@EXAMPLE.COM' });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe('CASE@EXAMPLE.COM');
  });
});

// ---------------------------------------------------------------------------
// Audit event
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — audit event', () => {
  it('writes an account_test_email_sent audit event on success', async () => {
    const agent = await loginAs('audited@example.com', 'student', 'Audited');

    await agent.post('/api/account/test-email').send({}).expect(200);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'account_test_email_sent' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ to: 'audited@example.com' });
  });
});

// ---------------------------------------------------------------------------
// Email body content
// ---------------------------------------------------------------------------

describe('POST /api/account/test-email — email body content', () => {
  it('includes the display name, timestamp, and My Account page explanation in the body', async () => {
    const agent = await loginAs('body-check@example.com', 'student', 'Body Check User');

    await agent.post('/api/account/test-email').send({}).expect(200);

    expect(fakeSend).toHaveBeenCalledOnce();
    const opts = fakeSend.mock.calls[0][0] as any;
    expect(opts.text).toContain('Body Check User');
    // Timestamp in ISO format contains 'T' and 'Z'.
    expect(opts.text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(opts.text).toContain('My Account page');
  });
});
