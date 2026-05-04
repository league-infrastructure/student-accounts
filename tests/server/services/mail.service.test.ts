/**
 * Unit tests for MailService (Sprint 028 T001).
 *
 * Mocks nodemailer.createTransport so no real SMTP connection is made.
 * Tests env-var presence → isConfigured(), send() happy path, and
 * MailNotConfiguredError when unconfigured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';

// We spy on createTransport before importing MailService so the module-level
// call is intercepted.
const mockSendMail = vi.fn();
const mockTransporter = { sendMail: mockSendMail };
const createTransportSpy = vi.spyOn(nodemailer, 'createTransport').mockReturnValue(
  mockTransporter as any,
);

// Import AFTER the spy is in place.
import { MailService, MailNotConfiguredError } from '../../../server/src/services/mail.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USERNAME = 'user@example.com';
  process.env.SMTP_PASSWORD = 'secret';
}

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USERNAME;
  delete process.env.SMTP_PASSWORD;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_SECURE;
  delete process.env.ADMIN_EMAILS;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSmtpEnv();
  mockSendMail.mockReset();
  createTransportSpy.mockClear();
});

afterEach(() => {
  clearSmtpEnv();
});

// ---------------------------------------------------------------------------
// isConfigured
// ---------------------------------------------------------------------------

describe('MailService.isConfigured()', () => {
  it('returns true when all four required env vars are set', () => {
    setSmtpEnv();
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(true);
  });

  it('returns false when SMTP_HOST is missing', () => {
    setSmtpEnv();
    delete process.env.SMTP_HOST;
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false when SMTP_PORT is missing', () => {
    setSmtpEnv();
    delete process.env.SMTP_PORT;
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false when SMTP_USERNAME is missing', () => {
    setSmtpEnv();
    delete process.env.SMTP_USERNAME;
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false when SMTP_PASSWORD is missing', () => {
    setSmtpEnv();
    delete process.env.SMTP_PASSWORD;
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false when all SMTP env vars are absent', () => {
    const svc = new MailService();
    expect(svc.isConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Construction does not throw
// ---------------------------------------------------------------------------

describe('MailService construction', () => {
  it('does not throw when all vars are missing', () => {
    expect(() => new MailService()).not.toThrow();
  });

  it('does not throw when vars are present', () => {
    setSmtpEnv();
    expect(() => new MailService()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// send() — configured
// ---------------------------------------------------------------------------

describe('MailService.send() — configured', () => {
  it('resolves with messageId when transport resolves', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValueOnce({ messageId: 'test-message-id-001' });

    const svc = new MailService();
    const result = await svc.send({
      to: 'student@example.com',
      subject: 'Test',
      text: 'Hello world',
    });

    expect(result).toEqual({ messageId: 'test-message-id-001' });
  });

  it('passes to/subject/text/html to the transporter', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-002' });

    const svc = new MailService();
    await svc.send({
      to: 'student@example.com',
      subject: 'Hello',
      text: 'Plain text',
      html: '<p>HTML</p>',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        subject: 'Hello',
        text: 'Plain text',
        html: '<p>HTML</p>',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// send() — not configured
// ---------------------------------------------------------------------------

describe('MailService.send() — not configured', () => {
  it('throws MailNotConfiguredError when SMTP vars are missing', async () => {
    const svc = new MailService();
    await expect(
      svc.send({ to: 'a@b.com', subject: 'x', text: 'y' }),
    ).rejects.toBeInstanceOf(MailNotConfiguredError);
  });

  it('MailNotConfiguredError is an instance of Error', async () => {
    const svc = new MailService();
    await expect(
      svc.send({ to: 'a@b.com', subject: 'x', text: 'y' }),
    ).rejects.toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// from address resolution
// ---------------------------------------------------------------------------

describe('MailService from address', () => {
  it('uses SMTP_FROM when set', async () => {
    setSmtpEnv();
    process.env.SMTP_FROM = 'custom@from.com';
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-003' });

    const svc = new MailService();
    await svc.send({ to: 'a@b.com', subject: 'x', text: 'y' });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'custom@from.com' }),
    );
  });

  it('falls back to first ADMIN_EMAILS entry when SMTP_FROM is absent', async () => {
    setSmtpEnv();
    process.env.ADMIN_EMAILS = 'admin@league.org, other@league.org';
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-004' });

    const svc = new MailService();
    await svc.send({ to: 'a@b.com', subject: 'x', text: 'y' });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'admin@league.org' }),
    );
  });

  it('falls back to SMTP_USERNAME when SMTP_FROM and ADMIN_EMAILS are absent', async () => {
    setSmtpEnv();
    mockSendMail.mockResolvedValueOnce({ messageId: 'msg-005' });

    const svc = new MailService();
    await svc.send({ to: 'a@b.com', subject: 'x', text: 'y' });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'user@example.com' }),
    );
  });
});
