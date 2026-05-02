/**
 * Tests for the ClaudeCode page (Sprint 021, ticket 002).
 *
 * Covers:
 *  - Student with active claude account: renders install/auth/verify steps.
 *  - Student with pending claude account: renders pending message.
 *  - Student with no claude ExternalAccount: renders "not enabled" message.
 *  - Student with non-active/non-pending status: renders "access not available".
 *  - Non-student user: renders "not enabled" message (no account query fires).
 *  - Route smoke test: /claude-code resolves correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClaudeCode from '../../../client/src/pages/ClaudeCode';

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
    role: role.toUpperCase(),
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

function makeAccountPayload(overrides: {
  externalAccounts?: Array<{ id: number; type: string; status: string; externalId: string | null; createdAt: string }>;
} = {}) {
  return {
    profile: {
      id: 1,
      displayName: 'Test Student',
      primaryEmail: 'student@example.com',
      cohort: null,
      role: 'student',
      approvalStatus: 'approved',
      createdAt: '2025-01-01T00:00:00Z',
      llmProxyEnabled: false,
      workspaceTempPassword: null,
      username: null,
      has_password: false,
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
    externalAccounts: overrides.externalAccounts ?? [],
  };
}

function makeFetch(options: {
  accountPayload?: ReturnType<typeof makeAccountPayload>;
} = {}) {
  return vi.fn(async (url: string) => {
    if (url === '/api/account') {
      if (options.accountPayload) {
        return {
          ok: true,
          json: async () => options.accountPayload,
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderClaudeCode() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClaudeCode />
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
// Active claude account — install/auth/verify steps
// ===========================================================================

describe('ClaudeCode page — active claude account', () => {
  it('renders the page title', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /claude code/i })).toBeInTheDocument();
    });
  });

  it('renders Install step', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/install claude code/i)).toBeInTheDocument();
    });
  });

  it('renders Sign in step with claude auth login command', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText('claude auth login')).toBeInTheDocument();
    });
  });

  it('renders Verify step', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/verify/i)).toBeInTheDocument();
    });
  });

  it('shows the student primary email in the sign-in hint', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/student@example\.com/i)).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// Pending claude account
// ===========================================================================

describe('ClaudeCode page — pending claude account', () => {
  it('renders pending message', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'pending', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/invite is pending/i)).toBeInTheDocument();
    });
  });

  it('does NOT render install/verify steps for pending account', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'pending', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/invite is pending/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/install claude code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/claude auth login/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// No claude ExternalAccount — "not enabled" state
// ===========================================================================

describe('ClaudeCode page — no claude ExternalAccount', () => {
  it('shows graceful not-enabled message', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/claude code is not enabled on your account/i)).toBeInTheDocument();
    });
  });

  it('does NOT render install steps when no claude account', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({ externalAccounts: [] }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/install claude code/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Non-active, non-pending status
// ===========================================================================

describe('ClaudeCode page — non-active/non-pending status', () => {
  it('shows access not available message', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'suspended', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderClaudeCode();

    await waitFor(() => {
      expect(screen.getByText(/not currently available/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/suspended/)).toBeInTheDocument();
  });
});

// ===========================================================================
// Non-student user
// ===========================================================================

describe('ClaudeCode page — non-student (staff)', () => {
  it('renders not-enabled for staff user without firing account query', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    const fetchMock = makeFetch();
    (globalThis as any).fetch = fetchMock;

    renderClaudeCode();

    await waitFor(() => {
      expect(
        screen.getByText(/claude code is not enabled on your account/i),
      ).toBeInTheDocument();
    });

    const accountCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => url === '/api/account',
    );
    expect(accountCalls).toHaveLength(0);
  });
});

// ===========================================================================
// Route smoke test
// ===========================================================================

describe('ClaudeCode page — route smoke test', () => {
  it('/claude-code route renders the ClaudeCode page within a router', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({ externalAccounts: [] }),
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/claude-code']}>
          <Routes>
            <Route path="/claude-code" element={<ClaudeCode />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /claude code/i }),
      ).toBeInTheDocument();
    });
  });
});
