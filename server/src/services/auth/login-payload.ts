/**
 * login-payload.ts — typed accessors over Login.provider_payload and
 * Login.directory_metadata JSON columns (Sprint 017 T005).
 *
 * All functions are pure (no I/O, no async, no Prisma calls). They accept a
 * Login record and return a typed value extracted from the JSON columns, or a
 * safe default if the data is absent or malformed.
 *
 * Storage stays generic (Prisma `Json`); consumers read through these helpers
 * so a future schema change or additional provider can be absorbed in one file.
 */

import type { Login } from '../../generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface GoogleDirectoryMetadata {
  ou_path: string | null;
  groups: { id: string; name: string; email: string }[];
}

// ---------------------------------------------------------------------------
// Internal type guards
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isStringTriple(v: unknown): v is { id: string; name: string; email: string } {
  return (
    isObject(v) &&
    isString((v as any).id) &&
    isString((v as any).name) &&
    isString((v as any).email)
  );
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

/**
 * Returns the Google groups for a Login, or an empty array if absent or
 * non-Google. Handles missing, null, and malformed directory_metadata
 * gracefully — never throws.
 */
export function getGoogleGroups(
  login: Login,
): { id: string; name: string; email: string }[] {
  if (!login || login.provider !== 'google') return [];

  const meta = login.directory_metadata;
  if (!isObject(meta)) return [];

  const raw = (meta as any).groups;
  if (!Array.isArray(raw)) return [];

  const result: { id: string; name: string; email: string }[] = [];
  for (const item of raw) {
    if (isStringTriple(item)) {
      result.push({ id: item.id, name: item.name, email: item.email });
    }
  }
  return result;
}

/**
 * Returns the Google OU path for a Login, or null if absent or non-Google.
 * Handles missing, null, and malformed directory_metadata gracefully.
 */
export function getGoogleOu(login: Login): string | null {
  if (!login || login.provider !== 'google') return null;

  const meta = login.directory_metadata;
  if (!isObject(meta)) return null;

  const ouPath = (meta as any).ou_path;
  if (!isString(ouPath)) return null;
  return ouPath;
}

/**
 * Returns the GitHub username from the GitHub provider payload, or null.
 * Looks for `login` field on the payload (GitHub's terminology for username).
 */
export function getGitHubLogin(login: Login): string | null {
  if (!login || login.provider !== 'github') return null;

  const payload = login.provider_payload;
  if (!isObject(payload)) return null;

  const githubLogin = (payload as any).login;
  if (!isString(githubLogin)) return null;
  return githubLogin;
}

/**
 * Returns the Pike13 person id from the Pike13 provider payload, or null.
 * Looks for `id` field on the payload.
 */
export function getPike13Id(login: Login): string | null {
  if (!login || login.provider !== 'pike13') return null;

  const payload = login.provider_payload;
  if (!isObject(payload)) return null;

  const id = (payload as any).id;
  if (!isString(id)) return null;
  return id;
}
