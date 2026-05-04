/**
 * MailService — thin outbound-mail abstraction over nodemailer (Sprint 028 T001).
 *
 * Reads SMTP credentials from environment variables:
 *  - SMTP_HOST (required)
 *  - SMTP_PORT (required)
 *  - SMTP_USERNAME (required)
 *  - SMTP_PASSWORD (required)
 *  - SMTP_SECURE (optional; default false — port 587 uses STARTTLS)
 *  - SMTP_FROM (optional; falls back to first ADMIN_EMAILS entry, then SMTP_USERNAME)
 *
 * Construction NEVER throws. If any required var is absent, a single warn is
 * logged and isConfigured() returns false. send() throws MailNotConfiguredError
 * when the service is unconfigured.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createLogger } from './logger.js';

const logger = createLogger('mail-service');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MailNotConfiguredError extends Error {
  constructor(message = 'Mail is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, and SMTP_PASSWORD.') {
    super(message);
    this.name = 'MailNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  messageId: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MailService {
  private readonly configured: boolean;
  private readonly transporter?: Transporter;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const username = process.env.SMTP_USERNAME;
    const password = process.env.SMTP_PASSWORD;

    if (!host || !port || !username || !password) {
      const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD']
        .filter((v) => !process.env[v])
        .join(', ');
      logger.warn(`[mail-service] SMTP not configured — missing: ${missing}. Mail will not be sent.`);
      this.configured = false;
      this.from = '';
      return;
    }

    // Resolve from address: SMTP_FROM > first ADMIN_EMAILS entry > SMTP_USERNAME.
    const adminEmails = process.env.ADMIN_EMAILS ?? '';
    const firstAdmin = adminEmails.split(',').map((e) => e.trim()).filter(Boolean)[0];
    this.from = process.env.SMTP_FROM ?? firstAdmin ?? username;

    const secure = (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure,
      auth: { user: username, pass: password },
    });

    this.configured = true;
  }

  // --------------------------------------------------------------------------
  // isConfigured
  // --------------------------------------------------------------------------

  /** Returns true when all four required SMTP env vars were present at construction. */
  isConfigured(): boolean {
    return this.configured;
  }

  // --------------------------------------------------------------------------
  // send
  // --------------------------------------------------------------------------

  /**
   * Send an email via the configured SMTP transport.
   *
   * Throws MailNotConfiguredError if the service is not configured.
   * Resolves with { messageId } on success.
   */
  async send(opts: SendOptions): Promise<SendResult> {
    if (!this.configured || !this.transporter) {
      throw new MailNotConfiguredError();
    }

    const info = await this.transporter.sendMail({
      from: this.from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });

    return { messageId: info.messageId };
  }
}
