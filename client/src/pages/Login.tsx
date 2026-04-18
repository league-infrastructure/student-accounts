import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useProviderStatus } from '../hooks/useProviderStatus';

export default function Login() {
  const { loginWithCredentials } = useAuth();
  const navigate = useNavigate();
  const providerStatus = useProviderStatus();
  const anyProvider = providerStatus.github || providerStatus.google || providerStatus.pike13;

  const [username, setUsername] = useState('user');
  const [password, setPassword] = useState('pass');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await loginWithCredentials(username, password);
    if (result.ok) {
      navigate('/', { replace: true });
    } else {
      setError(result.error ?? 'Invalid credentials');
    }
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-1">Sign in</h1>
        <p className="text-sm text-slate-500 mb-6">Demo: user/pass or admin/admin</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="username" className="text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {!providerStatus.loading && anyProvider && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-slate-400">Or sign in with</span>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {providerStatus.github && (
                <a
                  href="/api/auth/github"
                  className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: '#24292e' }}
                >
                  Sign in with GitHub
                </a>
              )}
              {providerStatus.google && (
                <a
                  href="/api/auth/google"
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Sign in with Google
                </a>
              )}
              {providerStatus.pike13 && (
                <a
                  href="/api/auth/pike13"
                  className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: '#f37121' }}
                >
                  Sign in with Pike 13
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
