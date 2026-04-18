import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

/** Shape returned by GET /api/auth/me. */
export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  avatarUrl: string | null;
  provider: string | null;
  providerId: string | null;
  createdAt: string;
  updatedAt: string;
  // Impersonation fields (populated by Sprint 018 impersonation middleware)
  impersonating?: boolean;
  realAdmin?: { id: string; displayName: string } | null;
  // OAuth-linked providers (populated by /api/auth/me, Sprint 018 social login)
  linkedProviders?: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  loginWithCredentials: (
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data: AuthUser = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    fetchMe().finally(() => setLoading(false));
  }, []);

  function login(authedUser: AuthUser) {
    setUser(authedUser);
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setUser(null);
  }

  async function loginWithCredentials(
    username: string,
    password: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        await fetchMe();
        return { ok: true };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? 'Invalid credentials' };
    } catch {
      return { ok: false, error: 'Network error' };
    }
  }

  async function refresh() {
    await fetchMe();
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, loginWithCredentials, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
