/**
 * Role constants and helpers for the client.
 * Mirrors the server-side UserRole enum from Prisma.
 */

export const ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;

export type UserRole = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<UserRole, string> = {
  USER: 'User',
  ADMIN: 'Administrator',
};

export const ROLE_SHORT_LABELS: Record<UserRole, string> = {
  USER: 'user',
  ADMIN: 'admin',
};

/** Check whether the given role string has admin access. */
export function hasAdminAccess(role: string | undefined): boolean {
  return role === ROLES.ADMIN;
}

/**
 * Check whether the given role string has staff-level access.
 * Returns true for both staff and admin roles (case-insensitive for
 * compatibility with both legacy uppercase and lowercase role values).
 */
export function hasStaffAccess(role: string | undefined): boolean {
  if (!role) return false;
  const lower = role.toLowerCase();
  return lower === 'staff' || lower === 'admin';
}

/** Return a short display label for a role, defaulting to "user". */
export function roleShortLabel(role: string | undefined): string {
  if (role && role in ROLE_SHORT_LABELS) {
    return ROLE_SHORT_LABELS[role as UserRole];
  }
  return 'user';
}

/** Badge-style colours keyed by role. */
export const ROLE_BADGE_STYLES: Record<UserRole, { background: string; color: string }> = {
  USER: { background: '#e0e7ff', color: '#3730a3' },
  ADMIN: { background: '#fef3c7', color: '#92400e' },
};

/** Return inline badge styles for the given role string. */
export function roleBadgeStyle(role: string | undefined): { background: string; color: string } {
  if (role && role in ROLE_BADGE_STYLES) {
    return ROLE_BADGE_STYLES[role as UserRole];
  }
  return ROLE_BADGE_STYLES.USER;
}
