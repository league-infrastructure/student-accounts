/**
 * AccountLaptopCard — "Laptop login" on the student's Account page (sprint
 * 002 "laptop accounts" T006, SUC-006).
 *
 * Pure presentation over `profile.laptopLogin` from GET /api/account (the same
 * object GET /api/account/laptop returns); it fetches nothing itself. One line
 * per state, each telling the student the one thing to do next:
 *
 *   ready            — use username + password; choose "Other..." on the laptop
 *                      (the laptop login is just the account's username and password)
 *   needs_password   — set a password (link to the Username & Password section,
 *                      or the Add username/password flow when there is none yet)
 *   invalid_username — change the username (link to the username field)
 *   disabled         — account deactivated; ask an instructor
 *
 * `dirty` adds a small "Syncing to laptops…" note: the last roster write
 * failed and the hourly job will retry.
 *
 * Links target the ids UsernamePasswordSection renders (`ups-username`,
 * `ups-new-password`) so a click scrolls to the right field.
 */

export type LaptopLoginStateName =
  | 'ready'
  | 'disabled'
  | 'needs_password'
  | 'invalid_username';

export interface LaptopLoginState {
  enabled: boolean;
  state: LaptopLoginStateName;
  username: string | null;
  dirty: boolean;
  lastWritten?: string | null;
}

interface Props {
  laptop: LaptopLoginState;
  /** True when the account already has a username or a password (so the
   *  Username & Password section is on the page to link to). */
  hasCredentials: boolean;
  /** Opens the Add username/password modal (used when !hasCredentials). */
  onAddCredentials: () => void;
}

export const USERNAME_RULES_HINT = '3-32 lowercase letters, digits or dashes';

export default function AccountLaptopCard({ laptop, hasCredentials, onAddCredentials }: Props) {
  return (
    <div style={styles.card} data-testid="laptop-login-card">
      <h2 style={styles.sectionTitle}>Laptop login</h2>
      <div style={styles.body} data-testid="laptop-login-state" data-state={laptop.state}>
        <StateLine laptop={laptop} hasCredentials={hasCredentials} onAddCredentials={onAddCredentials} />
      </div>
      {laptop.dirty && (
        <p role="status" style={styles.syncNote} data-testid="laptop-login-syncing">
          Syncing to laptops…
        </p>
      )}
    </div>
  );
}

function StateLine({ laptop, hasCredentials, onAddCredentials }: Props) {
  switch (laptop.state) {
    case 'ready':
      return (
        <p style={styles.text}>
          At the login screen on a League laptop choose <em>Other...</em> and use username{' '}
          <strong style={styles.username}>{laptop.username}</strong> and your password.
        </p>
      );

    case 'needs_password':
      return (
        <p style={styles.text}>
          Set a password to log in on League laptops.{' '}
          {hasCredentials ? (
            <a href="#ups-new-password" style={styles.link}>
              Set a password
            </a>
          ) : (
            <button type="button" onClick={onAddCredentials} style={styles.linkButton}>
              Add username/password
            </button>
          )}
        </p>
      );

    case 'invalid_username':
      return (
        <p style={styles.text}>
          {laptop.username
            ? `This username can't be used on laptops. Change it to ${USERNAME_RULES_HINT}.`
            : `You need a username to log in on League laptops. Choose ${USERNAME_RULES_HINT}.`}{' '}
          {hasCredentials ? (
            <a href="#ups-username" style={styles.link}>
              {laptop.username ? 'Change username' : 'Choose a username'}
            </a>
          ) : (
            <button type="button" onClick={onAddCredentials} style={styles.linkButton}>
              Add username/password
            </button>
          )}
        </p>
      );

    case 'disabled':
    default:
      return (
        <p style={styles.text}>This account is deactivated, so laptop login is locked. Ask an instructor.</p>
      );
  }
}

// ---------------------------------------------------------------------------
// Styles (mirror Account.tsx's card vocabulary)
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.5rem',
    background: '#fff',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: '1rem',
    marginTop: 0,
  },
  body: {
    fontSize: '0.9rem',
    color: '#374151',
    lineHeight: 1.6,
  },
  text: {
    margin: 0,
  },
  username: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#1e293b',
  },
  link: {
    color: '#2563eb',
    textDecoration: 'none',
    fontWeight: 500,
  },
  linkButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    color: '#2563eb',
    fontWeight: 500,
    cursor: 'pointer',
  },
  syncNote: {
    marginTop: '0.75rem',
    marginBottom: 0,
    fontSize: '0.8rem',
    color: '#92400e',
    background: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: 6,
    padding: '4px 10px',
    display: 'inline-block',
  },
};
