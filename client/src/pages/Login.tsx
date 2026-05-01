import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Brand SVGs inlined so the buttons render without a network round-trip.
// Each is recolored to fit on its own brand-colored button background.

// Google "G" — official 4-color mark, sits on a white button.
function GoogleLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44c11 0 20-9 20-20 0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3 0 5.7 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3a12 12 0 0 1-7.3 2.5c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.5l6.3 5.3c-.4.4 6.5-4.8 6.5-14.8 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

// GitHub Octocat — white on a black button.
function GitHubLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.1-.4-.6-1.6.1-3.3 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.7.2 2.9.1 3.3.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/>
    </svg>
  );
}

// Pike 13 — just the iconic intersecting-bars mark from their official
// brand SVG, recolored to white for the green button background.
function Pike13Logo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 36 40" fill="currentColor" aria-hidden="true">
      <path d="M20.04 18.85L11.08 13.76L35.15 0.11C35.60 -0.15 35.98 0.06 35.98 0.58L36.00 8.86C36.01 9.37 35.63 10.00 35.18 10.26L20.04 18.85ZM0 22.27L7.01 26.24L0.86 29.73C0.40 29.99 0.03 29.78 0.02 29.26L0 22.27Z"/>
      <path d="M0.86 10.27L35.17 29.74C35.63 30.00 36.00 30.63 36.00 31.15L35.98 39.42C35.98 39.94 35.60 40.15 35.14 39.89L0.83 20.43C0.37 20.17 0 19.53 0 19.02L0.02 10.74C0.03 10.22 0.40 10.01 0.86 10.27Z"/>
    </svg>
  );
}

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  pending_approval:
    'Your account is awaiting approval by an admin. You\'ll be able to sign in once an admin approves you.',
  permanently_denied:
    'Your account has been denied. Contact an admin if you think this is a mistake.',
  staff_lookup_failed:
    "Couldn't verify your Google Workspace organizational unit. Try again, or contact an admin.",
  oauth_denied: 'Sign-in was cancelled or failed. Try again.',
  already_linked: 'That Google account is already linked to a different user.',
};

/**
 * Single sign-in form: username + passphrase.
 *
 * The same passphrase that an instructor distributed to the class is
 * also the student's permanent password. So on submit we try
 * `POST /api/auth/login` first; if that returns 401 we fall through to
 * `POST /api/auth/passphrase-signup` with the exact same credentials.
 * That covers both cases (returning student / first-time class
 * onboard) without exposing two redundant forms to the user.
 *
 * OAuth buttons (Google, GitHub) sit below for staff and admins.
 */
export default function Login() {
  const { loginWithCredentials } = useAuth();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Surface OAuth-callback errors that came in via ?error=... query param.
  useEffect(() => {
    const code = searchParams.get('error');
    if (code && OAUTH_ERROR_MESSAGES[code]) {
      setError(OAUTH_ERROR_MESSAGES[code]);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // Try logging in first — works for any returning user.
    const login = await loginWithCredentials(username.trim(), passphrase);
    if (login.ok) {
      window.location.assign('/account');
      return;
    }

    // Login failed. Try signup with the same credentials — this is the
    // first-time-with-class-passphrase path. The signup endpoint enforces
    // its own validation; on failure we surface a generic message.
    try {
      const res = await fetch('/api/auth/passphrase-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), passphrase }),
      });
      if (res.ok) {
        window.location.assign('/account');
        return;
      }
      const body = await res.json().catch(() => ({}));
      const serverError = (body as { error?: string }).error ?? null;
      if (res.status === 409) {
        setError('That username is already taken. Try another.');
      } else if (res.status === 400 && serverError) {
        setError(serverError);
      } else {
        setError(
          'Invalid username or passphrase. If your instructor gave you a passphrase, double-check it.',
        );
      }
    } catch {
      setError('Network error. Try again.');
    }
    setSubmitting(false);
  }

  const inputClass =
    'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelClass = 'text-sm font-medium text-slate-700';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-6">Sign in</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="login-username" className={labelClass}>
              Username
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={2}
              maxLength={32}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="login-passphrase" className={labelClass}>
              Passphrase
            </label>
            <input
              id="login-passphrase"
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="current-password"
              required
              className={inputClass}
            />
            <p className="text-xs text-slate-500">
              The phrase your instructor gave you, or the one you used to sign up.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* OAuth buttons for staff and admins. Always shown — if a
            provider isn't configured, the server returns 501 with a
            setup link, which is more useful than hiding the button. */}
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-slate-400">Or sign in with</span>
          </div>
        </div>
        <div className="flex gap-2">
          <a
            href="/api/auth/google"
            aria-label="Sign in with Google"
            className="flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white py-3 hover:bg-slate-50"
          >
            <GoogleLogo />
          </a>
          <a
            href="/api/auth/github"
            aria-label="Sign in with GitHub"
            className="flex flex-1 items-center justify-center rounded-lg py-3 text-white hover:opacity-90"
            style={{ background: '#24292e' }}
          >
            <GitHubLogo />
          </a>
          <a
            href="/api/auth/pike13"
            aria-label="Sign in with Pike 13"
            className="flex flex-1 items-center justify-center rounded-lg py-3 text-white hover:opacity-90"
            style={{ background: '#00833D' }}
          >
            <Pike13Logo />
          </a>
        </div>
      </div>
    </div>
  );
}
