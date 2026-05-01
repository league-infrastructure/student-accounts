/**
 * linkHandler — attaches a new OAuth Login to the current authenticated user.
 *
 * Called from OAuth callback routes when `session.link === true` and
 * `session.userId` is present. This is the backend implementation for
 * UC-010 (Student Adds Own Login).
 *
 * This module is a pure service function (no Express types) so it can be
 * tested independently of the HTTP layer.
 *
 * Flow:
 *  1. Look up any existing Login for (provider, providerUserId).
 *  2. If found and attached to the SAME user → idempotent, return { action: 'already_linked' }.
 *  3. If found and attached to a DIFFERENT user → deny, return { action: 'conflict' }.
 *  4. If not found → create Login, record add_login audit event atomically,
 *     return { action: 'linked' }.
 *
 * The caller (route handler) is responsible for session cleanup and redirects.
 *
 * See Sprint 003 T005 for full acceptance criteria.
 */

import { createLogger } from '../logger.js';
import type { LoginService } from '../login.service.js';

const logger = createLogger('link.handler');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface LinkProfile {
  /** Provider-assigned unique identifier for this account. */
  providerUserId: string;
  /** Email address returned by the provider (may be null for GitHub). */
  providerEmail: string | null;
  /** Display name from the provider profile (unused during link; stored for logging). */
  displayName: string;
  /** Provider-specific username (GitHub login, etc). Null for Google. */
  providerUsername?: string | null;
}

export type LinkAction = 'linked' | 'already_linked' | 'conflict';

export interface LinkResult {
  action: LinkAction;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Attach a new OAuth Login to an existing authenticated user.
 *
 * @param provider       - OAuth provider name ('google' | 'github').
 * @param profile        - Profile data from the OAuth provider.
 * @param currentUserId  - The authenticated user's id (from session).
 * @param loginService   - LoginService instance for Login operations.
 * @returns              - A LinkResult describing the outcome.
 *                         Callers redirect based on the action:
 *                           'linked'        → /account (success)
 *                           'already_linked'→ /account (idempotent)
 *                           'conflict'      → /account?error=already_linked
 */
export async function linkHandler(
  provider: 'google' | 'github' | 'pike13',
  profile: LinkProfile,
  currentUserId: number,
  loginService: LoginService,
): Promise<LinkResult> {
  const { providerUserId, providerEmail, providerUsername } = profile;

  // --- Step 1: Look up any existing Login for this provider identity ---
  const existingLogin = await loginService.findByProvider(provider, providerUserId);

  if (existingLogin) {
    if (existingLogin.user_id === currentUserId) {
      // --- Step 2: Already attached to the current user → idempotent ---
      logger.info(
        { userId: currentUserId, provider, providerUserId },
        '[link.handler] Provider identity already attached to the current user — idempotent.',
      );
      return { action: 'already_linked' };
    }

    // --- Step 3: Attached to a DIFFERENT user → conflict, deny ---
    logger.warn(
      { currentUserId, ownedByUserId: existingLogin.user_id, provider, providerUserId },
      '[link.handler] Provider identity is already attached to a DIFFERENT user — rejecting link.',
    );
    return { action: 'conflict' };
  }

  // --- Step 4: New identity — create Login and record audit event atomically ---
  await loginService.create(
    currentUserId,
    provider,
    providerUserId,
    providerEmail ?? null,
    currentUserId, // actor = current user (self-service action)
    providerUsername ?? null,
  );

  logger.info(
    { userId: currentUserId, provider, providerUserId },
    '[link.handler] New Login attached to current user.',
  );

  return { action: 'linked' };
}
