/**
 * Tests for Services page (Sprint 020, ticket 005).
 *
 * Covers:
 *  - Student with all entitlements: Workspace + Claude + LLM Proxy all render.
 *  - Student with no entitlements: empty-state message renders.
 *  - Workspace temp-password surfaces on first render when account payload signals it.
 *  - Non-student (staff): empty-state renders.
 *  - Mounted route /services resolves to the Services page within AppLayout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Services from '../../../client/src/pages/Services';

// ---------------------------------------------------------------------------
// Mock AuthContext
// ---------------------------------------------------------------------------

const mockUseAuth = vi.fn();

vi.mock('../../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---------------------------------------------------------------------------
// Mock useAccountEventStream (used indirectly via Account — not needed here,
// but Services does NOT import it so no mock needed).
// ---------------------------------------------------------------------------

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

/** Minimal student account payload with all fields configurable. */
function makeAccountPayload(overrides: {
  approvalStatus?: string;
  workspaceTempPassword?: string | null;
  llmProxyEnabled?: boolean;
  externalAccounts?: Array<{ id: number; type: string; status: string; externalId: string | null; createdAt: string }>;
} = {}) {
  return {
    profile: {
      id: 1,
      displayName: 'Test Student',
      primaryEmail: 'student@example.com',
      cohort: null,
      role: 'student',
      approvalStatus: overrides.approvalStatus ?? 'approved',
      createdAt: '2025-01-01T00:00:00Z',
      llmProxyEnabled: overrides.llmProxyEnabled ?? false,
      workspaceTempPassword: overrides.workspaceTempPassword ?? null,
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

/** LLM proxy response for enabled state. */
function makeLlmProxyEnabled() {
  return {
    enabled: true,
    endpoint: 'https://llm.example.com',
    token: 'llmp_testtoken',
    tokensUsed: 1000,
    tokenLimit: 50000,
    requestCount: 5,
    expiresAt: '2026-12-31T00:00:00Z',
  };
}

/** Build a fetch mock that routes to appropriate fixtures. */
function makeFetch(options: {
  accountPayload?: ReturnType<typeof makeAccountPayload>;
  llmProxyPayload?: { enabled: boolean; endpoint: string; token?: string | null };
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
    if (url === '/api/account/llm-proxy') {
      const payload = options.llmProxyPayload ?? { enabled: false, endpoint: 'http://proxy' };
      return {
        ok: true,
        json: async () => payload,
      };
    }
    if (url === '/api/integrations/status') {
      return {
        ok: true,
        json: async () => ({
          github: { configured: true },
          google: { configured: true },
          pike13: { configured: true },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderServices() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Services />
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
// All entitlements: student with workspace + claude + llm proxy
// ===========================================================================

describe('Services page — student with all entitlements', () => {
  it('renders all three zones: Services table, Claude Code, LLM Proxy', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        llmProxyEnabled: true,
        externalAccounts: [
          { id: 1, type: 'workspace', status: 'active', externalId: 'student@jointheleague.org', createdAt: '2025-01-01T00:00:00Z' },
          { id: 2, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
      llmProxyPayload: makeLlmProxyEnabled(),
    });

    renderServices();

    // Wait for all three sections to appear
    await waitFor(() => {
      expect(screen.getByText('League Email')).toBeInTheDocument();
    });

    // Claude Code section
    expect(screen.getByRole('heading', { name: /claude code/i })).toBeInTheDocument();

    // LLM Proxy section
    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /llm proxy/i })).toBeInTheDocument();
  });

  it('does NOT show the empty-state message when all three zones render', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        llmProxyEnabled: true,
        externalAccounts: [
          { id: 1, type: 'workspace', status: 'active', externalId: 'student@jointheleague.org', createdAt: '2025-01-01T00:00:00Z' },
          { id: 2, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
      llmProxyPayload: makeLlmProxyEnabled(),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^services$/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('services-empty-state')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// No entitlements — empty state
// ===========================================================================

describe('Services page — student with no entitlements', () => {
  it('shows the empty-state message and no zone headings', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        llmProxyEnabled: false,
        externalAccounts: [],
      }),
      llmProxyPayload: { enabled: false, endpoint: 'http://proxy' },
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByTestId('services-empty-state')).toBeInTheDocument();
    });

    // Zone headings must not be present
    expect(screen.queryByText('League Email')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /claude code/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-llm-proxy-card')).not.toBeInTheDocument();
  });

  it('empty-state text mentions no external services linked', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload(),
      llmProxyPayload: { enabled: false, endpoint: 'http://proxy' },
    });

    renderServices();

    await waitFor(() => {
      expect(
        screen.getByText(/no external services are linked to your account/i),
      ).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// Workspace temp-password first-view surfacing
// ===========================================================================

describe('Services page — workspace temp-password', () => {
  it('surfaces temp password when account payload includes workspaceTempPassword', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        workspaceTempPassword: 'TempPass123!',
        externalAccounts: [
          { id: 1, type: 'workspace', status: 'active', externalId: 'student@jointheleague.org', createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByText('TempPass123!')).toBeInTheDocument();
    });

    // Should appear inside the workspace row context
    expect(screen.getByText('League Email')).toBeInTheDocument();
  });

  it('does NOT show temp-password field when workspaceTempPassword is null', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        workspaceTempPassword: null,
        externalAccounts: [
          { id: 1, type: 'workspace', status: 'active', externalId: 'student@jointheleague.org', createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByText('League Email')).toBeInTheDocument();
    });

    // Temp-password hint text should not appear
    expect(screen.queryByText(/password:/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Non-student users: staff
// ===========================================================================

describe('Services page — non-student (staff)', () => {
  it('renders empty state for a staff user (no account query fires)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    // fetch should not be called for /api/account
    const fetchMock = makeFetch();
    (globalThis as any).fetch = fetchMock;

    renderServices();

    // Services page heading renders
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^services$/i })).toBeInTheDocument();
    });

    // Empty state shown for non-students
    expect(screen.getByTestId('services-empty-state')).toBeInTheDocument();

    // No account query should have fired
    const accountCalls = fetchMock.mock.calls.filter(
      ([url]: [string]) => url === '/api/account',
    );
    expect(accountCalls).toHaveLength(0);
  });
});

// ===========================================================================
// Smoke test: route /services resolves to Services page
// ===========================================================================

describe('Services page — route smoke test', () => {
  it('/services route renders the Services page within a router', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload(),
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/services']}>
          <Routes>
            <Route path="/services" element={<Services />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^services$/i })).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// Claude Code section: only when claude ExternalAccount present
// ===========================================================================

describe('Services page — Claude Code section gating', () => {
  it('does NOT render Claude Code section when no claude ExternalAccount exists', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'workspace', status: 'active', externalId: 'student@jointheleague.org', createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByText('League Email')).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /claude code/i })).not.toBeInTheDocument();
  });

  it('renders Claude Code section when a claude ExternalAccount exists', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({
        externalAccounts: [
          { id: 1, type: 'claude', status: 'active', externalId: null, createdAt: '2025-01-01T00:00:00Z' },
        ],
      }),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /claude code/i })).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// LLM Proxy section: only when llmProxyEnabled is true
// ===========================================================================

describe('Services page — LLM Proxy section gating', () => {
  it('does NOT render LLM Proxy card when llmProxyEnabled is false', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({ llmProxyEnabled: false }),
    });

    renderServices();

    // Wait for page to settle
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^services$/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('account-llm-proxy-card')).not.toBeInTheDocument();
  });

  it('renders LLM Proxy card when llmProxyEnabled is true', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch({
      accountPayload: makeAccountPayload({ llmProxyEnabled: true }),
      llmProxyPayload: makeLlmProxyEnabled(),
    });

    renderServices();

    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });
  });
});
