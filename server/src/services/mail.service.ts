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

export type SendResult =
  /** Delivered to the transport. */
  | { messageId: string; skipped?: undefined }
  /** Deliberately not sent (e.g. an undeliverable `.invalid` recipient). */
  | { skipped: true; reason: string; messageId?: undefined };

/**
 * True when `address` cannot be delivered to by construction: its domain is
 * (or ends in) the reserved `.invalid` TLD (RFC 2606). Imported laptop
 * accounts get `<id>@laptop.invalid` as a placeholder primary_email.
 */
export function isUndeliverableAddress(address: string): boolean {
  if (typeof address !== 'string') return false;
  // Accept "Name <user@host>" as well as a bare address; take the last '@'.
  const bare = address.trim().replace(/^.*<([^>]*)>\s*$/, '$1');
  const at = bare.lastIndexOf('@');
  if (at === -1) return false;
  const domain = bare.slice(at + 1).toLowerCase().replace(/\.+$/, '');
  return domain === 'invalid' || domain.endsWith('.invalid');
}

// ---------------------------------------------------------------------------
// Template: "Your League account" (sprint 002 T005, SUC-003)
// ---------------------------------------------------------------------------

export const CREDENTIALS_EMAIL_SUBJECT = 'Your League account';

/** Included when the user has (or will have) a laptop roster entry. */
export const LAPTOP_LOGIN_LINE =
  'On a League laptop, choose Other... at the login screen and use this username and password.';

export interface CredentialsEmailInput {
  displayName: string;
  /** The username to sign in with; null when the user has none yet. */
  username: string | null;
  /** The sign-in email, used instead of the username when there is none. */
  email: string;
  /** Plaintext password, only when the sender supplied one in this request. */
  password?: string;
  /** Where to sign in — the site's origin, e.g. https://accounts.jointheleague.org */
  siteUrl: string;
  /** True when a usable laptop roster entry exists for this user. */
  laptopLogin: boolean;
  /** Optional free-text note from the admin, appended verbatim (escaped in HTML). */
  note?: string;
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the credentials email an admin sends a student (or parent).
 *
 * Pure: no I/O. The password appears only when `input.password` is given —
 * it is never read from storage. The laptop sentence appears only when
 * `laptopLogin` is true.
 */
export function buildCredentialsEmail(input: CredentialsEmailInput): MailContent {
  const name = input.displayName.trim() || 'there';
  const lines: string[] = [`Hi ${name},`, '', 'Here is your League account.', ''];

  if (input.username) {
    lines.push(`Username: ${input.username}`);
  } else {
    lines.push(`Sign in with your email address: ${input.email}`);
  }
  if (input.password !== undefined) lines.push(`Password: ${input.password}`);
  lines.push('', `Sign in at ${input.siteUrl}`);
  if (input.laptopLogin) lines.push('', LAPTOP_LOGIN_LINE);
  const note = input.note?.trim();
  if (note) lines.push('', note);
  lines.push('', '— The League');

  const text = lines.join('\n');
  const html =
    '<div style="font-family: sans-serif; font-size: 14px; color: #0f172a;">' +
    lines
      .map((l) => (l === '' ? '<br>' : `<div>${escapeHtml(l)}</div>`))
      .join('') +
    '</div>';

  return { subject: CREDENTIALS_EMAIL_SUBJECT, text, html };
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

    // Resolve from address: EMAIL_FROM_ADDRESS > SMTP_FROM > first ADMIN_EMAILS
    // entry > SMTP_USERNAME. EMAIL_FROM_NAME (when set) wraps it as
    // `"Display Name" <address>` so recipients see a friendly sender.
    const adminEmails = process.env.ADMIN_EMAILS ?? '';
    const firstAdmin = adminEmails.split(',').map((e) => e.trim()).filter(Boolean)[0];
    const fromAddress =
      process.env.EMAIL_FROM_ADDRESS ?? process.env.SMTP_FROM ?? firstAdmin ?? username;
    const fromName = process.env.EMAIL_FROM_NAME?.trim();
    // Quote the display name to be safe with commas / specials.
    this.from = fromName ? `"${fromName.replace(/"/g, '\\"')}" <${fromAddress}>` : fromAddress;

    const secure = (process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure,
      auth: { user: username, pass: password },
      // Surface the SMTP transcript in dev when SMTP_DEBUG=true.
      logger: process.env.SMTP_DEBUG === 'true',
      debug: process.env.SMTP_DEBUG === 'true',
    });

    this.configured = true;

    logger.info(
      `[mail-service] SMTP transporter ready — host=${host} port=${port} secure=${secure} from=${this.from} user=${username}`,
    );
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
   * A recipient under the reserved `.invalid` TLD is never sent to: the call
   * logs at info and resolves with { skipped: true } instead of throwing, so
   * callers that mail placeholder addresses degrade quietly.
   * Throws MailNotConfiguredError if the service is not configured.
   * Resolves with { messageId } on success.
   */
  async send(opts: SendOptions): Promise<SendResult> {
    if (isUndeliverableAddress(opts.to)) {
      logger.info(
        `[mail-service] skipped — to=${opts.to} is under the reserved .invalid domain subject="${opts.subject}"`,
      );
      return { skipped: true, reason: 'undeliverable .invalid recipient' };
    }

    if (!this.configured || !this.transporter) {
      logger.warn(
        `[mail-service] send() called while not configured — to=${opts.to} subject="${opts.subject}"`,
      );
      throw new MailNotConfiguredError();
    }

    logger.info(
      `[mail-service] sending — to=${opts.to} from=${this.from} subject="${opts.subject}"`,
    );

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });

      logger.info(
        `[mail-service] sent — messageId=${info.messageId} response=${(info as any).response ?? '(no transport response)'} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)}`,
      );
      return { messageId: info.messageId };
    } catch (err: any) {
      logger.error(
        `[mail-service] send failed — to=${opts.to} from=${this.from}: ${err?.message ?? err} (code=${err?.code ?? 'n/a'} response=${err?.response ?? 'n/a'} responseCode=${err?.responseCode ?? 'n/a'})`,
      );
      throw err;
    }
  }
}
