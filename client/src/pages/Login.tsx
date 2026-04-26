import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

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
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        <div className="flex flex-col gap-2">
          <a
            href="/api/auth/google"
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Sign in with Google
          </a>
          <a
            href="/api/auth/github"
            className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            style={{ background: '#24292e' }}
          >
            Sign in with GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
