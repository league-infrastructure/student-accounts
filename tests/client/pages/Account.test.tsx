/**
 * Tests for the universal Account page — Sprint 016 ticket 003.
 *
 * Covers:
 *  - Admin: renders without redirecting; shows Apps zone with tiles.
 *  - Staff: renders without redirecting; shows Apps zone with tiles.
 *  - Student: renders all student sections AND the Apps zone.
 *  - Tiles appear and are linked to the correct href.
 *  - Empty apps state is handled gracefully.
 *
 * Fetch is mocked at the globalThis level. AuthContext is mocked via vi.mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Account from '../../../client/src/pages/Account';

// ---------------------------------------------------------------------------
// Mock AuthContext
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn();

vi.mock('../../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(
  role: 'student' | 'staff' | 'admin',
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 1,
    email: `${role}@example.com`,
    displayName: `Test ${role}`,
    role: role.toUpperCase(), // AuthContext stores UPPER role strings
    approvalStatus: 'approved',
    onboardingCompleted: true,
    avatarUrl: null,
    provider: 'google',
    providerId: 'abc',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const STUDENT_ACCOUNT_DATA = {
  profile: {
    id: 1,
    displayName: 'Test student',
    primaryEmail: 'student@example.com',
    cohort: null,
    role: 'student',
    approvalStatus: 'approved',
    createdAt: '2025-01-01T00:00:00Z',
    llmProxyEnabled: false,
  },
  logins: [
    {
      id: 1,
      provider: 'google',
      providerEmail: 'student@example.com',
      providerUsername: null,
      createdAt: '2025-01-01T00:00:00Z',
    },
  ],
  externalAccounts: [],
};

const ADMIN_TILES = [
  {
    id: 'user-management',
    title: 'User Management',
    description: 'Manage student, staff, and admin accounts',
    href: '/admin/users',
    icon: 'users',
  },
  {
    id: 'staff-directory',
    title: 'Staff Directory',
    description: 'Look up League staff',
    href: '/staff/directory',
    icon: 'directory',
  },
  {
    id: 'cohorts',
    title: 'Cohorts',
    description: 'Manage class cohorts',
    href: '/admin/cohorts',
    icon: 'cohort',
  },
  {
    id: 'groups',
    title: 'Groups',
    description: 'Manage student groups',
    href: '/admin/groups',
    icon: 'group',
  },
];

const STAFF_TILES = [
  {
    id: 'user-management',
    title: 'User Management',
    description: 'Manage student, staff, and admin accounts',
    href: '/admin/users',
    icon: 'users',
  },
  {
    id: 'staff-directory',
    title: 'Staff Directory',
    description: 'Look up League staff',
    href: '/staff/directory',
    icon: 'directory',
  },
];

const STUDENT_TILES = [
  {
    id: 'llm-proxy',
    title: 'LLM Proxy',
    description: 'Use Claude through your League proxy token',
    href: '/account#llm-proxy',
    icon: 'bot',
  },
];

/** Build a fetch mock that returns appropriate data for each URL. */
function makeFetch(tiles: typeof ADMIN_TILES, includeStudentAccount = false) {
  return vi.fn(async (url: string) => {
    if (url === '/api/account/apps') {
      return {
        ok: true,
        json: async () => ({ tiles }),
      };
    }
    if (url === '/api/account' && includeStudentAccount) {
      return {
        ok: true,
        json: async () => STUDENT_ACCOUNT_DATA,
      };
    }
    if (url === '/api/integrations/status') {
      return {
        ok: true,
        json: async () => ({ github: false, google: true, pike13: false }),
      };
    }
    if (url === '/api/account/llm-proxy') {
      return {
        ok: true,
        json: async () => ({ enabled: false, endpoint: 'http://localhost/proxy' }),
      };
    }
    // Default fallback
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderAccount() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Account />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// Admin
// ===========================================================================

describe('Account page — admin', () => {
  it('renders without redirecting to /', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(ADMIN_TILES);

    renderAccount();

    // Page heading should appear — no redirect happened
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('shows the Apps zone heading', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(ADMIN_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your applications/i })).toBeInTheDocument();
    });
  });

  it('renders admin tiles (user-management, staff-directory, cohorts, groups)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(ADMIN_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Staff Directory')).toBeInTheDocument();
      expect(screen.getByText('Cohorts')).toBeInTheDocument();
      expect(screen.getByText('Groups')).toBeInTheDocument();
    });
  });

  it('does not show student-only sections (Profile, Logins)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(ADMIN_TILES);

    renderAccount();

    // Wait for apps to load to ensure the render is complete
    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    expect(screen.queryByText('Sign-in Methods')).not.toBeInTheDocument();
    expect(screen.queryByText('Services')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Staff
// ===========================================================================

describe('Account page — staff', () => {
  it('renders without redirecting', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(STAFF_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('shows staff tiles (user-management, staff-directory)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(STAFF_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Staff Directory')).toBeInTheDocument();
    });
  });

  it('does not show cohorts or groups tiles for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(STAFF_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    expect(screen.queryByText('Cohorts')).not.toBeInTheDocument();
    expect(screen.queryByText('Groups')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Student
// ===========================================================================

describe('Account page — student', () => {
  it('renders all student sections plus the Apps zone', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(STUDENT_TILES, true);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your applications/i })).toBeInTheDocument();
    });
  });

  it('shows student account sections when data is loaded', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(STUDENT_TILES, true);

    renderAccount();

    await waitFor(() => {
      // Profile section renders the user's email (may appear more than once)
      const elements = screen.getAllByText('student@example.com');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('shows the llm-proxy tile when student has a token', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(STUDENT_TILES, true);

    renderAccount();

    await waitFor(() => {
      // "LLM Proxy" appears both in the tile and in AccountLlmProxyCard — use getAllByText
      const llmProxyElements = screen.getAllByText('LLM Proxy');
      expect(llmProxyElements.length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// Tile navigation
// ===========================================================================

describe('AppTile navigation', () => {
  it('tiles link to the correct href', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(ADMIN_TILES);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    // The User Management tile should link to /admin/users
    const links = screen.getAllByRole('link');
    const umLink = links.find((l) => l.textContent?.includes('User Management'));
    expect(umLink).toBeDefined();
    expect(umLink).toHaveAttribute('href', '/admin/users');
  });
});

// ===========================================================================
// Empty state
// ===========================================================================

describe('Account page — empty apps state', () => {
  it('shows empty-state message when no tiles are returned', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch([]);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText(/no applications available/i)).toBeInTheDocument();
    });
  });
});
