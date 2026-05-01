/**
 * isSafeNext — same-origin redirect target validation.
 *
 * Used by the Login page to decide whether the `?next=` query parameter
 * should be honored after a successful sign-in. The check prevents
 * open-redirect attacks (ticket 019-009; see architecture-update.md §
 * "Risks — Same-origin `next=` validation").
 *
 * Rule: accept only absolute-path references that begin with exactly ONE
 * `/` followed by a character that is neither `/` nor `\`. This covers:
 *   - Scheme-relative URLs:  //evil.com        → rejected
 *   - Backslash redirect:    /\evil.com        → rejected
 *   - Protocol URLs:         https://evil.com  → rejected
 *   - javascript: URIs:      (no leading `/`) → rejected
 *   - Control characters:    \x00–\x1f         → rejected
 *   - Empty string or null:                    → rejected
 *
 * Do NOT rely solely on URL parsing (new URL(next, origin).origin ===
 * origin); tricky encodings have bypassed that check historically.
 * Belt-and-suspenders: the leading-/+non-//non-\ check is the primary
 * gate; control-character rejection is an additional hardening layer.
 */
export function isSafeNext(next: string | null | undefined): boolean {
  if (!next || typeof next !== 'string') return false;

  // Reject any control characters (includes null bytes \x00–\x1f).
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(next)) return false;

  // Must start with exactly one `/` followed by a non-`/` non-`\` character.
  // This rejects:  //  ///  /\  as well as anything that doesn't start with /.
  if (!/^\/[^/\\]/.test(next)) return false;

  return true;
}
