import { useState } from 'react';

const ROLES = ['admin', 'staff', 'student'] as const;
type Role = (typeof ROLES)[number];

export default function HomePage() {
  const [email, setEmail] = useState('eric.busboom@jointheleague.org');
  const [role, setRole] = useState<Role>('admin');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, role, displayName: email.split('@')[0] }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Sign-in failed (${res.status})`);
      }
      window.location.href = role === 'admin' ? '/admin/provisioning-requests' : '/account';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-800 mb-2">Dev Sign-In</h1>
      <p className="text-sm text-slate-500 mb-6">
        Shortcut sign-in for development. Disabled when <code>NODE_ENV=production</code>.
      </p>

      <form onSubmit={signIn} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="border border-slate-300 rounded-lg px-3 py-2"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-slate-200">
        <p className="text-xs text-slate-500 mb-2">Or real OAuth:</p>
        <div className="flex gap-2">
          <a
            href="/api/auth/google"
            className="text-sm text-indigo-600 hover:underline"
          >
            Google
          </a>
          <a
            href="/api/auth/github"
            className="text-sm text-indigo-600 hover:underline"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
