/**
 * Tests for the Account page — Sprint 020 (post tile-launchpad removal).
 *
 * Covers:
 *  - Admin: renders without redirecting; no tile sections.
 *  - Staff: renders without redirecting; no tile sections.
 *  - Student: renders profile and login sections; no tile sections.
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

/** Build a fetch mock that returns appropriate data for each URL. */
function makeFetch(includeStudentAccount = false) {
  return vi.fn(async (url: string) => {
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
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    // Page heading should appear — no redirect happened
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('does NOT show Apps zone heading (tile launchpad removed)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /your applications/i })).not.toBeInTheDocument();
  });

  it('does not show student-only sections (Profile, Logins) for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
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
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('does NOT show Apps zone for staff (removed in Sprint 020)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /your applications/i })).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Student
// ===========================================================================

describe('Account page — student', () => {
  it('renders student account sections', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true);

    renderAccount();

    await waitFor(() => {
      // Profile section renders the user's email (may appear more than once)
      const elements = screen.getAllByText('student@example.com');
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('does NOT show Apps zone for student (removed in Sprint 020)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true);

    renderAccount();

    await waitFor(() => {
      // Wait for data to load
      const elements = screen.getAllByText('student@example.com');
      expect(elements.length).toBeGreaterThan(0);
    });

    expect(screen.queryByRole('heading', { name: /your applications/i })).not.toBeInTheDocument();
  });
});
