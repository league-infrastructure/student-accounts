/**
 * Helpers for highlighting recently-created users in admin tables.
 */

export const NEW_USER_BG = '#fefce8';

/**
 * True if `iso` is within the last `hours` hours (default 24).
 * Accepts ISO strings or anything `Date` can parse; returns false on
 * invalid input so callers don't need to guard.
 */
export function isRecent(iso: string | null | undefined, hours = 24): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < hours * 60 * 60 * 1000;
}
