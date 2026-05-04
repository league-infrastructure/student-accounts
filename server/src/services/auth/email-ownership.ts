/**
 * Email ownership classifier (Sprint 028 follow-up).
 *
 * When a user types an email address into a setup / profile / notification
 * field, the server needs to know whether the address is:
 *  - 'free'  — not present on any User row, Login.provider_email, or
 *              workspace ExternalAccount.external_id anywhere in the DB.
 *              Safe to associate with the current user.
 *  - 'mine'  — present, and every occurrence belongs to the current user.
 *              Safe to use as a notification address; nothing changes.
 *  - 'other' — present on at least one record owned by a DIFFERENT user.
 *              MUST be rejected so a user cannot claim someone else's email.
 *
 * `currentUserId` may be null (e.g., during signup before any User row
 * exists for the actor). In that case any presence whatsoever returns
 * 'other'.
 *
 * Comparison is case-insensitive throughout.
 */

import { prisma } from '../prisma.js';

export type EmailOwnership = 'free' | 'mine' | 'other';

export async function classifyEmailOwnership(
  rawEmail: string,
  currentUserId: number | null,
): Promise<EmailOwnership> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return 'free';

  // SQLite (dev/test) does not support Prisma's mode: 'insensitive' filter.
  // Storage convention is lowercase (passphrase-signup writes
  // primary_email lowercase; provider_email / external_id are typically
  // already lowercased by the providers). Compare against the lowercased
  // input directly.

  // 1. Any User with this primary_email?
  const userByPrimary = await (prisma as any).user.findFirst({
    where: { primary_email: email },
    select: { id: true },
  });

  // 2. Any Login.provider_email matches?
  const loginRows = await (prisma as any).login.findMany({
    where: { provider_email: email },
    select: { user_id: true },
  });

  // 3. Any workspace ExternalAccount with external_id == email?
  const externalRows = await (prisma as any).externalAccount.findMany({
    where: { type: 'workspace', external_id: email },
    select: { user_id: true },
  });

  const owners = new Set<number>();
  if (userByPrimary) owners.add(userByPrimary.id);
  for (const r of loginRows) owners.add(r.user_id);
  for (const r of externalRows) owners.add(r.user_id);

  if (owners.size === 0) return 'free';
  if (currentUserId === null) return 'other';
  if (owners.size === 1 && owners.has(currentUserId)) return 'mine';
  if (owners.has(currentUserId) && owners.size > 1) return 'other';
  return 'other';
}
