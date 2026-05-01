/**
 * Express Request augmentation for OAuth bearer token context (Sprint 018).
 *
 * Attached by the oauthBearer middleware after successful token validation.
 * Consumed by route handlers that need to know which OAuth client or user
 * is making the request.
 */

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by oauthBearer middleware when a valid bearer token is presented.
       * Undefined if the route is not protected by oauthBearer.
       */
      oauth?: {
        /** The OAuth client's client_id string. */
        client_id: string;
        /** The OAuth client's numeric primary key. */
        oauth_client_id: number;
        /** The token's associated user_id (null for client-credentials tokens). */
        user_id: number | null;
        /** Scopes granted to this token. */
        scopes: string[];
      };
    }
  }
}

export {};
