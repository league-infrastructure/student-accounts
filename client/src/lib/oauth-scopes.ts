/**
 * Human-readable labels for OAuth scope identifiers.
 *
 * Used by the consent page (OAuthConsent.tsx) to display scope chips.
 * Add an entry here whenever a new scope is introduced in the codebase.
 */
export const SCOPE_LABELS: Record<string, string> = {
  profile: 'Your basic profile (name, email, role)',
  'users:read': 'Read directory of users',
};

/** Returns a label for a scope, falling back to the raw scope string. */
export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}
