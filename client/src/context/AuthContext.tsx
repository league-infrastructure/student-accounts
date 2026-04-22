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
  /** 'approved' or 'pending'. Pending users see only the "account pending" page. */
  approvalStatus?: 'approved' | 'pending';
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
    // Dev-only shortcut. Maps template credentials to test-login payloads.
    // user/pass → student, admin/admin → admin, anything else → 401.
    const mapping: Record<string, { email: string; role: string }> = {
      'user:pass': { email: 'user@example.com', role: 'student' },
      'admin:admin': { email: 'eric.busboom@jointheleague.org', role: 'admin' },
    };
    const match = mapping[`${username}:${password}`];
    if (!match) {
      return { ok: false, error: 'Invalid credentials' };
    }
    try {
      const res = await fetch('/api/auth/test-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: match.email,
          role: match.role,
          displayName: username,
        }),
      });
      if (res.ok) {
        await fetchMe();
        return { ok: true };
      }
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string }).error ?? 'Sign-in failed' };
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
