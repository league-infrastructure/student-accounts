/**
 * prettifyName — display-name derivation for admin user lists.
 *
 * Rules (display only — DB is never mutated):
 *   1. If email ends with @jointheleague.org AND the local part matches
 *      /^[a-z]+\.[a-z]+$/, return "TitleCase(first) TitleCase(last)".
 *   2. Otherwise, return displayName if present.
 *   3. Fallback: return the local part of the email.
 */

interface UserForName {
  email: string;
  displayName: string | null;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function prettifyName(user: UserForName): string {
  const { email, displayName } = user;

  if (email.endsWith('@jointheleague.org')) {
    const local = email.split('@')[0];
    if (/^[a-z]+\.[a-z]+$/.test(local)) {
      const [first, last] = local.split('.');
      return `${titleCase(first)} ${titleCase(last)}`;
    }
  }

  if (displayName) return displayName;

  // Fallback: local part of email
  return email.split('@')[0];
}
