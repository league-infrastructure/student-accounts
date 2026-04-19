/**
 * Merge-scan stub — placeholder for Sprint 007 implementation.
 *
 * This module exports a single `mergeScan` function that is called after
 * every new User creation in the sign-in handler. Sprint 007 will replace
 * this implementation wholesale at the same import path — the call site in
 * sign-in.handler.ts remains unchanged.
 *
 * Do NOT call this stub for staff Users (staff identity does not enter the
 * student merge queue, per architecture).
 */

import type { User } from '../../generated/prisma/client.js';

/**
 * No-op merge scan. Logs deferral and returns immediately.
 * Sprint 007 will replace this function with the real merge similarity check.
 *
 * @param user - The newly created User record.
 */
export async function mergeScan(user: User): Promise<void> {
  console.log(
    `[merge-scan] merge-scan deferred to Sprint 007 — no-op call site (userId=${user.id})`,
  );
}
