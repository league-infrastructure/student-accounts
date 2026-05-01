/**
 * OAuthConsentService — domain logic for OAuthConsent (Sprint 019).
 *
 * Responsibilities:
 *  - Find an existing consent row for (user, client, scopes) where the stored
 *    scopes are a superset of the requested scopes (so skipping the consent
 *    screen is safe — the user already granted everything needed).
 *  - Record (upsert) a consent row for a user+client+scopes triple.
 *    Unique constraint on (user_id, oauth_client_id) — re-consent replaces
 *    the existing row (no history this sprint).
 */

import { parseJsonArray, toJsonValue } from './oauth-client.service.js';

export class OAuthConsentService {
  constructor(private readonly prisma: any) {}

  // --------------------------------------------------------------------
  // find — return consent row only if stored scopes ⊇ requested scopes
  // --------------------------------------------------------------------

  async find(args: {
    user_id: number;
    client_id: number;
    scopes: string[];
  }): Promise<{ id: number; user_id: number; oauth_client_id: number; scopes: string[] } | null> {
    const row = await this.prisma.oAuthConsent.findUnique({
      where: {
        user_id_oauth_client_id: {
          user_id: args.user_id,
          oauth_client_id: args.client_id,
        },
      },
    });
    if (!row) return null;

    const storedScopes = parseJsonArray(row.scopes);
    // Return a hit only if every requested scope is covered by the stored set.
    const allCovered = args.scopes.every((s) => storedScopes.includes(s));
    if (!allCovered) return null;

    return {
      id: row.id,
      user_id: row.user_id,
      oauth_client_id: row.oauth_client_id,
      scopes: storedScopes,
    };
  }

  // --------------------------------------------------------------------
  // record — upsert consent for (user, client, scopes)
  // --------------------------------------------------------------------

  async record(args: {
    user_id: number;
    client_id: number;
    scopes: string[];
  }): Promise<{ id: number; user_id: number; oauth_client_id: number; scopes: string[] }> {
    const row = await this.prisma.oAuthConsent.upsert({
      where: {
        user_id_oauth_client_id: {
          user_id: args.user_id,
          oauth_client_id: args.client_id,
        },
      },
      update: {
        scopes: toJsonValue(args.scopes),
        granted_at: new Date(),
      },
      create: {
        user_id: args.user_id,
        oauth_client_id: args.client_id,
        scopes: toJsonValue(args.scopes),
      },
    });
    return {
      id: row.id,
      user_id: row.user_id,
      oauth_client_id: row.oauth_client_id,
      scopes: parseJsonArray(row.scopes),
    };
  }
}
