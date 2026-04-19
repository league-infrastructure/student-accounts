/**
 * Express-session module augmentation.
 *
 * Extends the SessionData interface with domain-specific fields that are
 * written by the sign-in handler after authentication and read by auth
 * middleware on subsequent requests.
 *
 * Only userId and role are stored server-side. No email, display name, or
 * OAuth tokens are persisted in the session.
 */

import type { UserRole } from '../generated/prisma/enums.js';

declare module 'express-session' {
  interface SessionData {
    userId: number;
    role: UserRole;
    /**
     * Set to true when the OAuth flow was initiated in link-mode (?link=1).
     * Cleared after the callback completes (success or conflict).
     */
    link?: boolean;
    /**
     * The URL to redirect to after a successful link-mode callback.
     * Currently always '/account'. Cleared after the callback completes.
     */
    linkReturnTo?: string;
  }
}
