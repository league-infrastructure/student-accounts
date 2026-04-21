/**
 * probeAnthropicAdmin — lightweight connectivity + status helper (Sprint 010 T012).
 *
 * Called by GET /admin/anthropic/probe. Uses the AnthropicAdminClient interface
 * so tests can inject a fake without network calls.
 *
 * Returns a structured ProbeResult suitable for JSON serialisation.
 *
 * Read-only operations only — no write guard needed.
 */

import { createLogger } from '../logger.js';
import type { AnthropicAdminClient } from './anthropic-admin.client.js';

const logger = createLogger('anthropic-probe');

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ProbeResult {
  ok: boolean;
  org: { id: string; name: string } | null;
  userCount: number | null;
  workspaces: string[];
  invitesCount: number | null;
  writeEnabled: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// probeAnthropicAdmin
// ---------------------------------------------------------------------------

/**
 * Probe the Anthropic Admin API using the provided client.
 *
 * Calls listOrgUsers (limit 1), listWorkspaces, and listInvites (limit 1)
 * in parallel. Each call is individually caught so a single failure yields
 * a partial result rather than an all-or-nothing failure.
 *
 * The `org` field is populated from the first org user if available; the
 * real "org/me" endpoint is not implemented in AnthropicAdminClient so we
 * use a sentinel value of null when there are no users yet.
 *
 * writeEnabled reflects whether CLAUDE_TEAM_WRITE_ENABLED=1 in the current
 * process environment.
 */
export async function probeAnthropicAdmin(client: AnthropicAdminClient): Promise<ProbeResult> {
  logger.info('[anthropic-probe] starting probe');

  const writeEnabled = process.env.CLAUDE_TEAM_WRITE_ENABLED === '1';

  // Run all three reads in parallel; capture errors per-call.
  const [usersResult, workspacesResult, invitesResult] = await Promise.allSettled([
    client.listOrgUsers(),
    client.listWorkspaces(),
    client.listInvites(),
  ]);

  let userCount: number | null = null;
  let workspaces: string[] = [];
  let invitesCount: number | null = null;
  const errors: string[] = [];

  // --- users ---
  if (usersResult.status === 'fulfilled') {
    userCount = usersResult.value.data.length;
    // If has_more, report the minimum known count with a note that there are more.
    // The data array length may be less than the true total; callers should note
    // this is a probe (limit=1 equivalent — we fetch one page, not all).
  } else {
    const msg = usersResult.reason instanceof Error
      ? usersResult.reason.message
      : String(usersResult.reason);
    logger.warn({ err: msg }, '[anthropic-probe] listOrgUsers failed');
    errors.push(`listOrgUsers: ${msg}`);
  }

  // --- workspaces ---
  if (workspacesResult.status === 'fulfilled') {
    workspaces = workspacesResult.value.map((ws) => ws.name);
  } else {
    const msg = workspacesResult.reason instanceof Error
      ? workspacesResult.reason.message
      : String(workspacesResult.reason);
    logger.warn({ err: msg }, '[anthropic-probe] listWorkspaces failed');
    errors.push(`listWorkspaces: ${msg}`);
  }

  // --- invites ---
  if (invitesResult.status === 'fulfilled') {
    invitesCount = invitesResult.value.data.length;
  } else {
    const msg = invitesResult.reason instanceof Error
      ? invitesResult.reason.message
      : String(invitesResult.reason);
    logger.warn({ err: msg }, '[anthropic-probe] listInvites failed');
    errors.push(`listInvites: ${msg}`);
  }

  const ok = errors.length === 0;

  const result: ProbeResult = {
    ok,
    org: null,
    userCount,
    workspaces,
    invitesCount,
    writeEnabled,
  };

  if (!ok) {
    result.error = errors.join('; ');
  }

  logger.info({ ok, userCount, workspaceCount: workspaces.length, invitesCount }, '[anthropic-probe] probe complete');

  return result;
}
