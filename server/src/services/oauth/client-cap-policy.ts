/**
 * ClientCapPolicy — per-user cap on active OAuth clients by role.
 *
 * Single source of truth for how many active (non-disabled) clients
 * each role may own simultaneously.
 *
 * Policy (stakeholder direction 2026-05-01):
 *   student → 1 active client
 *   staff   → unlimited
 *   admin   → unlimited
 *
 * Disabled clients (disabled_at IS NOT NULL) do not count toward the cap.
 */

import { ForbiddenError } from '../../errors.js';

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class ClientCapReachedError extends ForbiddenError {
  readonly code = 'CLIENT_CAP_REACHED';

  constructor(role: string, cap: number) {
    super(
      `Role '${role}' may not have more than ${cap} active OAuth client${cap === 1 ? '' : 's'}`,
    );
    this.name = 'ClientCapReachedError';
  }
}

// ---------------------------------------------------------------------------
// Policy table
// ---------------------------------------------------------------------------

/** null means unlimited */
const CAP_BY_ROLE: Record<string, number | null> = {
  student: 1,
  staff: null,
  admin: null,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ClientCapPolicy = {
  /**
   * Returns the maximum number of active clients the role may own,
   * or null when there is no limit.
   * Unknown roles return 0 (fail-safe / deny by default).
   */
  maxClientsFor(role: string): number | null {
    if (!(role in CAP_BY_ROLE)) return 0;
    return CAP_BY_ROLE[role];
  },

  /**
   * Throws ClientCapReachedError when currentCount >= cap.
   * Passes silently when the role has no cap (null).
   *
   * @param role         - The actor's role (e.g. 'student', 'staff', 'admin').
   * @param currentCount - Number of currently active (non-disabled) clients.
   */
  assertUnderCap(role: string, currentCount: number): void {
    const cap = ClientCapPolicy.maxClientsFor(role);
    if (cap === null) return; // unlimited
    if (currentCount >= cap) {
      throw new ClientCapReachedError(role, cap);
    }
  },
};
