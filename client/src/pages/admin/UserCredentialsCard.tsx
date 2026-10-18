/**
 * UserCredentialsCard — admin controls for a student's sign-in credentials
 * (sprint 002 "laptop accounts" T005, SUC-003).
 *
 * Rendered inside UserDetailPanel with the same inline-style vocabulary as
 * the neighbouring cards. Three things an instructor needs at the start of
 * a class:
 *
 *   - Username: field + Save            → PUT /api/admin/users/:id/credentials { username }
 *   - Password: "Set password" (typed, min 4, confirm) or "Generate"
 *                                       → PUT ... { password } | { generatePassword: true }
 *   - "Email credentials…" dialog        → POST /api/admin/users/:id/credentials/email
 *
 * Plaintext-once invariant: the server returns the password only in the PUT
 * response. It lives in this component's state, is shown once with Copy,
 * can be included in the email while it is there, and is cleared after the
 * email is sent, when the admin hides it, and (being state) when the card
 * unmounts. It is never written to storage or re-fetched.
 */

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../context/ToastContext';

export interface CredentialsState {
  username: string | null;
  hasPassword: boolean;
  allowsLaptopAccount: boolean;
  laptopLogin: boolean;
  displayName: string;
  primaryEmail: string;
  notificationEmail: string | null;
}

interface SetResult {
  username: string | null;
  password?: string;
}

type EmailResult = { sent: true } | { sent: false; skipped: true; reason: string };

interface Props {
  userId: number;
  userName?: string;
}

export const MIN_PASSWORD_LENGTH = 4;

/** Addresses under the reserved `.invalid` TLD cannot receive mail. */
export function isUndeliverable(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at === -1) return false;
  const domain = address.slice(at + 1).toLowerCase().replace(/\.+$/, '');
  return domain === 'invalid' || domain.endsWith('.invalid');
}

/** The address the email dialog starts with: notification, else primary, unless undeliverable. */
export function defaultRecipient(state: Pick<CredentialsState, 'notificationEmail' | 'primaryEmail'> | undefined): string {
  if (!state) return '';
  const candidate = state.notificationEmail ?? state.primaryEmail ?? '';
  return candidate && !isUndeliverable(candidate) ? candidate : '';
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? `HTTP ${res.status}`;
}

async function putCredentials(
  userId: number,
  body: { username?: string; password?: string; generatePassword?: boolean },
): Promise<SetResult> {
  const res = await fetch(`/api/admin/users/${userId}/credentials`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

async function postEmail(
  userId: number,
  body: { to: string; password?: string; note?: string },
): Promise<EmailResult> {
  const res = await fetch(`/api/admin/users/${userId}/credentials/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export default function UserCredentialsCard({ userId, userName }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: state, error: queryError } = useQuery<CredentialsState>({
    queryKey: ['admin', 'users', userId, 'credentials'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/credentials`);
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    enabled: Number.isFinite(userId),
  });

  const refetch = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'credentials'] });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Username -----------------------------------------------------------------
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  useEffect(() => {
    // Follow the server value until the admin starts typing.
    if (!usernameTouched) setUsernameInput(state?.username ?? '');
  }, [state?.username, usernameTouched]);

  // Password -----------------------------------------------------------------
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  /** The plaintext just set or generated; shown once, never persisted. */
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Email dialog -------------------------------------------------------------
  const [emailOpen, setEmailOpen] = useState(false);
  const [toInput, setToInput] = useState('');
  const [includePassword, setIncludePassword] = useState(false);
  const [noteInput, setNoteInput] = useState('');

  const name = userName ?? state?.displayName ?? 'this user';

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message ?? 'Request failed');
      showToast(e?.message ?? 'Request failed', 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function saveUsername() {
    const username = usernameInput.trim();
    if (!username) {
      setError('Enter a username.');
      return;
    }
    const result = await run(() => putCredentials(userId, { username }));
    if (!result) return;
    setUsernameTouched(false);
    showToast(`Username set to ${result.username}`, 'success');
    await refetch();
  }

  async function savePassword() {
    if (passwordInput.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (passwordInput !== confirmInput) {
      setError('The two passwords do not match.');
      return;
    }
    const result = await run(() => putCredentials(userId, { password: passwordInput }));
    if (!result) return;
    setPlaintext(result.password ?? passwordInput);
    setCopied(false);
    setPasswordInput('');
    setConfirmInput('');
    setShowSetPassword(false);
    showToast('Password set', 'success');
    await refetch();
  }

  async function generatePassword() {
    const result = await run(() => putCredentials(userId, { generatePassword: true }));
    if (!result?.password) return;
    setPlaintext(result.password);
    setCopied(false);
    setShowSetPassword(false);
    showToast('Password generated', 'success');
    await refetch();
  }

  function copyPlaintext() {
    if (!plaintext) return;
    navigator.clipboard?.writeText(plaintext).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }

  function openEmailDialog() {
    setToInput(defaultRecipient(state));
    setIncludePassword(plaintext !== null);
    setNoteInput('');
    setError(null);
    setEmailOpen(true);
  }

  async function sendEmail() {
    const to = toInput.trim();
    if (!to) {
      setError('Enter an email address.');
      return;
    }
    if (isUndeliverable(to)) {
      setError('That address cannot receive mail (.invalid).');
      return;
    }
    const body: { to: string; password?: string; note?: string } = { to };
    if (includePassword && plaintext) body.password = plaintext;
    if (noteInput.trim()) body.note = noteInput.trim();
    const result = await run(() => postEmail(userId, body));
    if (!result) return;
    if (result.sent) {
      showToast(`Credentials emailed to ${to}`, 'success');
      // The password has been delivered; it is no longer needed here.
      setPlaintext(null);
      setEmailOpen(false);
    } else {
      showToast(`Email not sent: ${result.reason}`, 'info');
    }
  }

  return (
    <section data-testid="credentials-card" style={cardStyle}>
      <h2 style={cardTitleStyle}>Credentials</h2>

      {(error || queryError) && (
        <div role="alert" style={errorStyle}>
          {error ?? (queryError as Error).message}
        </div>
      )}

      {/* Username ----------------------------------------------------------- */}
      <div style={rowStyle}>
        <label htmlFor="credentials-username" style={labelTextStyle}>
          Username
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            id="credentials-username"
            type="text"
            autoComplete="off"
            value={usernameInput}
            placeholder={state ? 'not set' : 'Loading…'}
            disabled={busy || !state}
            onChange={(e) => {
              setUsernameTouched(true);
              setUsernameInput(e.target.value);
            }}
            style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
          />
          <button
            type="button"
            onClick={saveUsername}
            disabled={busy || !state || usernameInput.trim() === (state?.username ?? '')}
            style={smallButtonStyle('primary', busy)}
          >
            Save username
          </button>
        </div>
        {state?.allowsLaptopAccount && (
          <div style={hintStyle}>
            Laptop login rules: 3–32 lowercase letters, digits and dashes, starting with a letter or digit.
          </div>
        )}
      </div>

      {/* Password ----------------------------------------------------------- */}
      <div style={rowStyle}>
        <div style={labelTextStyle}>Password</div>
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
          {state ? (state.hasPassword ? 'A password is set.' : 'No password set.') : 'Loading…'}
        </div>

        {plaintext && (
          <div data-testid="credentials-plaintext" style={plaintextBoxStyle}>
            <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>
              Shown once. Copy it or email it now — it is cleared when you email it, hide it, or leave this page.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={plaintextCodeStyle}>{plaintext}</code>
              <button type="button" onClick={copyPlaintext} style={copyBtnStyle}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setPlaintext(null)}
                style={copyBtnStyle}
                aria-label="Hide password"
              >
                Hide
              </button>
            </div>
          </div>
        )}

        {showSetPassword ? (
          <div>
            <div style={formGridStyle}>
              <label style={labelStyle}>
                <span style={labelTextStyle}>New password</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  style={inputStyle}
                  aria-label="New password"
                />
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Confirm password</span>
                <input
                  type="text"
                  autoComplete="off"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  style={inputStyle}
                  aria-label="Confirm password"
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button type="button" onClick={savePassword} disabled={busy} style={smallButtonStyle('primary', busy)}>
                Save password
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSetPassword(false);
                  setPasswordInput('');
                  setConfirmInput('');
                }}
                disabled={busy}
                style={smallButtonStyle('neutral', busy)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowSetPassword(true)}
              disabled={busy || !state}
              style={smallButtonStyle('neutral', busy)}
            >
              Set password
            </button>
            <button
              type="button"
              onClick={generatePassword}
              disabled={busy || !state}
              style={smallButtonStyle('neutral', busy)}
            >
              Generate password
            </button>
          </div>
        )}
      </div>

      {/* Email -------------------------------------------------------------- */}
      <div style={{ ...rowStyle, marginBottom: 0 }}>
        <button
          type="button"
          onClick={openEmailDialog}
          disabled={busy || !state}
          style={smallButtonStyle('primary', busy)}
        >
          Email credentials…
        </button>
      </div>

      {emailOpen && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-labelledby="credentials-email-title">
          <div style={modalStyle}>
            <h3 id="credentials-email-title" style={{ margin: '0 0 10px', fontSize: 16 }}>
              Email credentials to {name}
            </h3>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
              Sends "Your League account" with the username
              {plaintext ? ', optionally the password just set,' : ''} and where to sign in.
            </div>

            <label style={labelStyle}>
              <span style={labelTextStyle}>To</span>
              <input
                type="email"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
                placeholder="student or parent address"
                style={inputStyle}
                aria-label="To"
              />
            </label>

            <label style={{ ...checkboxLabelStyle, opacity: plaintext ? 1 : 0.6 }}>
              <input
                type="checkbox"
                checked={includePassword && plaintext !== null}
                disabled={plaintext === null}
                onChange={(e) => setIncludePassword(e.target.checked)}
              />
              <span>
                Include the password I just set
                {plaintext === null && (
                  <span style={{ color: '#64748b' }}> (set or generate one first)</span>
                )}
              </span>
            </label>

            <label style={labelStyle}>
              <span style={labelTextStyle}>Note (optional)</span>
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                aria-label="Note"
              />
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                type="button"
                onClick={() => setEmailOpen(false)}
                disabled={busy}
                style={smallButtonStyle('neutral', busy)}
              >
                Cancel
              </button>
              <button type="button" onClick={sendEmail} disabled={busy} style={smallButtonStyle('primary', busy)}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Styles (mirrors UserLlmProxyCard / UserDetailPanel)
// ---------------------------------------------------------------------------

function smallButtonStyle(variant: 'primary' | 'neutral', disabled = false): React.CSSProperties {
  const palette =
    variant === 'primary'
      ? { bg: '#2563eb', fg: '#fff', border: 'none' }
      : { bg: '#f1f5f9', fg: '#0f172a', border: '1px solid #cbd5e1' };
  return {
    padding: '7px 14px',
    background: palette.bg,
    color: palette.fg,
    border: palette.border,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '16px 18px',
  marginBottom: 14,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
};

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const rowStyle: React.CSSProperties = { marginBottom: 16 };

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#991b1b',
  background: '#fee2e2',
  border: '1px solid #fecaca',
  padding: '8px 10px',
  borderRadius: 6,
  marginBottom: 10,
};

const hintStyle: React.CSSProperties = { fontSize: 12, color: '#94a3b8', marginTop: 6 };

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginBottom: 10,
};

const labelTextStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  color: '#64748b',
  fontWeight: 600,
  marginBottom: 4,
};

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  fontSize: 13,
  margin: '4px 0 12px',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#fff',
  minWidth: 220,
  boxSizing: 'border-box',
};

const plaintextBoxStyle: React.CSSProperties = {
  background: '#fef3c7',
  border: '1px solid #fcd34d',
  borderRadius: 6,
  padding: '10px 12px',
  marginBottom: 10,
};

const plaintextCodeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 15,
  padding: '4px 8px',
  background: '#fff',
  borderRadius: 4,
  userSelect: 'all',
};

const copyBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#f8fafc',
  cursor: 'pointer',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9000,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 20,
  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25)',
  maxWidth: 460,
  width: '92%',
};
