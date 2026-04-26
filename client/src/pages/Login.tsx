import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

interface ProviderStatus {
  github: boolean;
  google: boolean;
  pike13: boolean;
}

export default function Login() {
  const { loginWithCredentials } = useAuth();

  // ---- Login form state ----
  const [username, setUsername] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);

  // ---- Signup form state ----
  const [signupUsername, setSignupUsername] = useState('');
  const [signupPassphrase, setSignupPassphrase] = useState('');
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  // ---- OAuth provider detection ----
  const [providers, setProviders] = useState<ProviderStatus>({
    github: false,
    google: false,
    pike13: false,
  });
  const [providersLoaded, setProvidersLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((data) => {
        setProviders({
          github: !!(data?.github?.configured),
          google: !!(data?.google?.configured),
          pike13: !!(data?.pike13?.configured),
        });
      })
      .catch(() => {
        // Leave all providers as false
      })
      .finally(() => setProvidersLoaded(true));
  }, []);

  const hasProviders = providers.github || providers.google || providers.pike13;

  // ---- Handlers ----

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoginSubmitting(true);
    setLoginError(null);
    const result = await loginWithCredentials(username, passphrase);
    if (result.ok) {
      window.location.assign('/account');
    } else {
      setLoginError(result.error ?? 'Invalid username or password');
    }
    setLoginSubmitting(false);
  }

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSignupSubmitting(true);
    setSignupError(null);
    try {
      const res = await fetch('/api/auth/passphrase-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: signupUsername, passphrase: signupPassphrase }),
      });
      if (res.ok) {
        window.location.assign('/account');
        return;
      }
      const body = await res.json().catch(() => ({}));
      const serverError = (body as { error?: string }).error;
      if (res.status === 401) {
        setSignupError('Invalid or expired passphrase');
      } else if (res.status === 409) {
        setSignupError('That username is already taken');
      } else if (res.status === 400 && serverError) {
        setSignupError(serverError);
      } else {
        setSignupError(serverError ?? 'Sign-up failed');
      }
    } catch {
      setSignupError('Network error');
    }
    setSignupSubmitting(false);
  }

  const inputClass =
    'border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelClass = 'text-sm font-medium text-slate-700';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white rounded-xl shadow-md w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-800 mb-6">Sign in</h1>

        {/* ---- Login form ---- */}
        <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
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
          </div>

          {loginError && (
            <p role="alert" className="text-sm text-red-600">
              {loginError}
            </p>
          )}

          <button
            type="submit"
            disabled={loginSubmitting}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {loginSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {/* ---- OAuth provider buttons (dynamic) ---- */}
        {providersLoaded && hasProviders && (
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
              {providers.github && (
                <a
                  href="/api/auth/github"
                  className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
                  style={{ background: '#24292e' }}
                >
                  Sign in with GitHub
                </a>
              )}
              {providers.google && (
                <a
                  href="/api/auth/google"
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Sign in with Google
                </a>
              )}
              {providers.pike13 && (
                <a
                  href="/api/auth/pike13"
                  className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  Sign in with Pike 13
                </a>
              )}
            </div>
          </>
        )}

        {/* ---- Passphrase signup disclosure panel ---- */}
        <div className="mt-6 border border-slate-200 rounded-lg">
          <button
            type="button"
            onClick={() => setSignupOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
            aria-expanded={signupOpen}
          >
            <span>New student? Sign up with a class passphrase</span>
            <span className="text-slate-400">{signupOpen ? '▲' : '▼'}</span>
          </button>

          {signupOpen && (
            <div className="px-4 pb-4 border-t border-slate-200">
              <form onSubmit={handleSignupSubmit} className="flex flex-col gap-4 mt-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="signup-username" className={labelClass}>
                    Username
                  </label>
                  <input
                    id="signup-username"
                    type="text"
                    value={signupUsername}
                    onChange={(e) => setSignupUsername(e.target.value)}
                    autoComplete="username"
                    required
                    minLength={2}
                    maxLength={32}
                    className={inputClass}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label htmlFor="signup-passphrase" className={labelClass}>
                    Passphrase
                  </label>
                  <input
                    id="signup-passphrase"
                    type="text"
                    value={signupPassphrase}
                    onChange={(e) => setSignupPassphrase(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>

                {signupError && (
                  <p role="alert" className="text-sm text-red-600">
                    {signupError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={signupSubmitting}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
                >
                  {signupSubmitting ? 'Signing up…' : 'Sign up'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
