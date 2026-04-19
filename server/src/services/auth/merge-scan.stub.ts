/**
 * Merge-scan entry point — thin adapter wiring the real implementation.
 * Sprint 007 T003: replaced the no-op stub with a forwarding adapter.
 *
 * This module exports `mergeScan(user)` — the signature used by all existing
 * call sites (sign-in.handler.ts, pike13-sync.service.ts, service.registry.ts).
 * It wires production dependencies (prisma singleton, HaikuClientImpl,
 * AuditService) and delegates to `mergeScanWithDeps` in merge-scan.service.ts.
 *
 * To inject test doubles, callers use `mergeScanWithDeps` directly — this
 * module is only used in production wiring.
 */

import type { User } from '../../generated/prisma/client.js';
import { prisma } from '../prisma.js';
import { AuditService } from '../audit.service.js';
import { HaikuClientImpl } from '../merge/haiku.client.js';
import { mergeScanWithDeps } from './merge-scan.service.js';

const _audit = new AuditService();

/**
 * Lazily-constructed HaikuClientImpl. Only instantiated on first call so
 * the process can start without ANTHROPIC_API_KEY present (the real client
 * defers credential use to the first API call).
 */
let _haiku: HaikuClientImpl | undefined;

function getHaiku(): HaikuClientImpl {
  if (!_haiku) {
    _haiku = new HaikuClientImpl(process.env.ANTHROPIC_API_KEY ?? '');
  }
  return _haiku;
}

/**
 * Run the Haiku-powered merge scan for a newly created User.
 *
 * @param user - The newly created User record.
 */
export async function mergeScan(user: User): Promise<void> {
  await mergeScanWithDeps(user, prisma, getHaiku(), _audit);
}
