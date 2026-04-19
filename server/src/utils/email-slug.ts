/**
 * email-slug.ts — utility for converting a user's display_name to a valid
 * email local-part (slug) suitable for use as the left-hand side of a
 * Workspace email address.
 *
 * Rules:
 *  - Normalize unicode to ASCII using transliteration-style decomposition.
 *  - Lowercase the result.
 *  - Replace spaces with dots.
 *  - Strip characters that are not alphanumeric, dots, or hyphens.
 *  - Collapse consecutive dots/hyphens into a single dot.
 *  - Strip leading and trailing dots/hyphens.
 *  - Truncate to MAX_SLUG_LENGTH characters (trimming at a dot boundary if
 *    possible).
 *  - Fall back to a numeric slug ('user<id>') if the resulting slug is shorter
 *    than MIN_SLUG_LENGTH.
 *
 * The resulting slug is a valid RFC 5321 local-part (no special characters
 * that require quoting).
 */

/** Maximum characters for the local-part of the email address. */
const MAX_SLUG_LENGTH = 30;

/** Minimum acceptable slug length before falling back to user ID. */
const MIN_SLUG_LENGTH = 3;

/**
 * Convert a display name to a deterministic email slug.
 *
 * @param displayName - The user's display name (e.g. "Alice Smith").
 * @param fallbackId  - Numeric ID used for the fallback slug ('user<id>').
 * @returns A string suitable as the local-part of an email address.
 *
 * @example
 * displayNameToSlug('Alice Smith', 42)   // 'alice.smith'
 * displayNameToSlug('José García', 42)   // 'jose.garcia'
 * displayNameToSlug('', 42)              // 'user42'
 * displayNameToSlug('A', 42)             // 'user42'
 */
export function displayNameToSlug(displayName: string, fallbackId: number): string {
  if (!displayName || !displayName.trim()) {
    return `user${fallbackId}`;
  }

  // Normalize unicode: decompose accented chars to base + combining marks,
  // then strip the combining marks (category M).
  const normalized = displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Lowercase
  let slug = normalized.toLowerCase();

  // Replace spaces with dots
  slug = slug.replace(/\s+/g, '.');

  // Strip any character that is not alphanumeric, dot, or hyphen
  slug = slug.replace(/[^a-z0-9.\-]/g, '');

  // Collapse runs of two or more consecutive dots/hyphens (mixed) into a
  // single dot. A lone hyphen is valid in an email local-part and is preserved.
  slug = slug.replace(/[.\-]{2,}/g, '.');

  // Strip leading and trailing dots/hyphens
  slug = slug.replace(/^[.\-]+|[.\-]+$/g, '');

  // Truncate to MAX_SLUG_LENGTH, preferring a dot boundary
  if (slug.length > MAX_SLUG_LENGTH) {
    const truncated = slug.slice(0, MAX_SLUG_LENGTH);
    const lastDot = truncated.lastIndexOf('.');
    if (lastDot >= MIN_SLUG_LENGTH) {
      slug = truncated.slice(0, lastDot);
    } else {
      slug = truncated;
    }
    // Strip any trailing dots/hyphens after truncation
    slug = slug.replace(/[.\-]+$/, '');
  }

  // Fallback if slug is too short
  if (slug.length < MIN_SLUG_LENGTH) {
    return `user${fallbackId}`;
  }

  return slug;
}

/**
 * Split a display name into given name and family name for the Google API.
 *
 * Heuristic:
 *  - First word → givenName
 *  - Remaining words → familyName
 *  - If only one word, familyName = givenName (Google requires both).
 *
 * @param displayName - The user's full display name.
 * @returns { givenName, familyName }
 */
export function splitDisplayName(displayName: string): { givenName: string; familyName: string } {
  const trimmed = (displayName ?? '').trim();
  if (!trimmed) {
    return { givenName: 'Student', familyName: 'User' };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { givenName: parts[0], familyName: parts[0] };
  }

  const givenName = parts[0];
  const familyName = parts.slice(1).join(' ');
  return { givenName, familyName };
}
