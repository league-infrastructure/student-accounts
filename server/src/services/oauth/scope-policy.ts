/**
 * ScopePolicy — role-based scope ceiling for OAuth client registration.
 *
 * Single source of truth for which scopes each role may request.
 * The client-side OAuthClients.tsx maintains a parallel const copy for UX;
 * this module is the authoritative enforcement point.
 *
 * Policy (stakeholder direction 2026-05-01):
 *   student → profile only
 *   staff   → profile, users:read
 *   admin   → profile, users:read
 */

import { ForbiddenError } from '../../errors.js';

// ---------------------------------------------------------------------------
// Policy table
// ---------------------------------------------------------------------------

const ALLOWED_SCOPES_BY_ROLE: Record<string, string[]> = {
  student: ['profile'],
  staff: ['profile', 'users:read'],
  admin: ['profile', 'users:read'],
};

/** Fall-through: unknown roles get no scopes (fail-safe). */
const FALLBACK_SCOPES: string[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const ScopePolicy = {
  /**
   * Returns the scopes the given role is permitted to request.
   * Unknown roles return an empty array (fail-safe / deny by default).
   */
  allowedScopesFor(role: string): string[] {
    return ALLOWED_SCOPES_BY_ROLE[role] ?? FALLBACK_SCOPES;
  },

  /**
   * Throws ForbiddenError when any requested scope exceeds the role ceiling.
   *
   * @param role            - The actor's role (e.g. 'student', 'staff', 'admin').
   * @param requestedScopes - The scopes the client wants to register.
   */
  assertAllowed(role: string, requestedScopes: string[]): void {
    const allowed = ScopePolicy.allowedScopesFor(role);
    const forbidden = requestedScopes.filter((s) => !allowed.includes(s));
    if (forbidden.length > 0) {
      throw new ForbiddenError(
        `Role '${role}' may not request scope(s): ${forbidden.join(', ')}`,
      );
    }
  },
};
