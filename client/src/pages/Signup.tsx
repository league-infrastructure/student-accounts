import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';

/**
 * Signup page for invitation-URL-based account creation.
 *
 * Reads `?passphrase=<value>` from the URL and includes it in the POST body
 * alongside the four fields the student fills in. On success, navigates to
 * /account. On failure, shows the server error inline.
 */
export default function Signup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [passphrase, setPassphrase] = useState(searchParams.get('passphrase') ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/passphrase-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passphrase,
          username: username.trim(),
          password,
          displayName: displayName.trim(),
          email: email.trim(),
        }),
      });

      if (res.ok) {
        navigate('/account');
        return;
      }

      const body = await res.json().catch(() => ({}));
      const serverError = (body as { error?: string }).error ?? null;

      if (res.status === 409) {
        setError('That username is already taken. Try another.');
      } else if (serverError) {
        setError(serverError);
      } else {
        setError('Sign-up failed. Check your passphrase and try again.');
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
        <h1 className="text-xl font-semibold text-slate-800 mb-6">Create account</h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="signup-passphrase" className={labelClass}>
              Passphrase
            </label>
            <input
              id="signup-passphrase"
              type="text"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="off"
              required
              className={inputClass}
            />
            <p className="text-xs text-slate-500">The phrase your instructor gave you</p>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="signup-username" className={labelClass}>
              Username
            </label>
            <input
              id="signup-username"
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
            <label htmlFor="signup-password" className={labelClass}>
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="signup-display-name" className={labelClass}>
              Full name
            </label>
            <input
              id="signup-display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
              required
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="signup-email" className={labelClass}>
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={inputClass}
            />
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
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{' '}
          <Link to="/login" className="text-indigo-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
