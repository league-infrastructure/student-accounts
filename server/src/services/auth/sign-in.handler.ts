/**
 * SignInHandler — shared verify callback logic for all OAuth strategies.
 *
 * This module is a pure service function: it accepts typed inputs and returns a
 * typed User. No Express types appear in its signature so it can be tested
 * independently of the request/response cycle.
 *
 * Responsibilities:
 *  1. Look up an existing Login by (provider, providerUserId).
 *  2. If found, return the associated User (no creation).
 *  3. If not found:
 *     a. Create a User (role=student, created_via=social_login) via
 *        UserService.createWithAudit — audit event written atomically.
 *     b. Create a Login via LoginService.create — audit event written
 *        atomically.
 *     c. Call scanNewUser (merge-scan stub).
 *  4. Staff OU detection seam: T005 will plug in here for @jointheleague.org
 *     accounts. Currently a no-op pass-through.
 *
 * See Sprint 002 architecture update for full flow description.
 */

import type { User } from '../../generated/prisma/client.js';
import type { UserService } from '../user.service.js';
import type { LoginService } from '../login.service.js';
import { scanNewUser } from './merge-scan.stub.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OAuthProfile {
  /** Provider-assigned unique identifier for this account. */
  providerUserId: string;
  /** Email address returned by the provider (may be null for GitHub). */
  providerEmail: string | null;
  /** Display name from the provider profile. */
  displayName: string;
  /** Provider-specific username (GitHub login, etc). Null for Google. */
  providerUsername?: string | null;
}

/**
 * Optional dependency-injected clients that T005 and beyond will use.
 * Defined here as an extension point so the handler signature is stable.
 *
 * T005 (staff OU detection) will add an `adminDirClient` property here
 * and update the relevant section of the handler.
 */
export interface SignInOptions {
  // Reserved for T005: adminDirClient?: AdminDirectoryClient;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Find or create a User and Login for an OAuth sign-in.
 *
 * @param provider      - OAuth provider name ('google' | 'github').
 * @param profile       - Profile data from the OAuth provider.
 * @param userService   - UserService instance for User operations.
 * @param loginService  - LoginService instance for Login operations.
 * @param _options      - Extension point for T005 (staff OU detection, etc).
 * @returns             - The User record (existing or newly created).
 */
export async function signInHandler(
  provider: 'google' | 'github',
  profile: OAuthProfile,
  userService: UserService,
  loginService: LoginService,
  _options?: SignInOptions,
): Promise<User> {
  const { providerUserId, providerEmail, displayName, providerUsername } = profile;

  // --- Step 1: Look up existing Login ---
  const existingLogin = await loginService.findByProvider(provider, providerUserId);

  if (existingLogin) {
    // --- Step 2: Existing identity — load and return the User ---
    return userService.findById(existingLogin.user_id);
  }

  // --- Step 3: New identity — create User and Login atomically ---

  // 3a. Create User with audit event
  const user = await userService.createWithAudit(
    {
      display_name: displayName || providerEmail || providerUserId,
      primary_email: providerEmail ?? `${providerUserId}@provider.invalid`,
      role: 'student',
      created_via: 'social_login',
    },
    null, // system action; no acting user
  );

  // 3b. Create Login with audit event
  await loginService.create(
    user.id,
    provider,
    providerUserId,
    providerEmail ?? null,
    null, // system action
  );

  // 3c. Merge-scan stub (Sprint 007 replaces this module)
  await scanNewUser(user);

  // --- Step 4: Staff OU detection seam (T005) ---
  // T005 will add @jointheleague.org domain detection here.
  // For non-jointheleague.org Google accounts (and all GitHub accounts),
  // the role stays 'student' as set in 3a.

  return user;
}
