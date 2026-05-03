/**
 * Tests for the Account page — Sprint 020 (post tile-launchpad removal),
 * widened in Sprint 022 to cover all authenticated roles.
 *
 * Covers:
 *  - Admin: renders Profile, Logins, and Add-Login buttons.
 *  - Staff: renders Profile, Logins, and Add-Login buttons.
 *  - Student: renders profile and login sections; no tile/services sections.
 *  - LoginsSection: three Add buttons (Google, GitHub, Pike 13); always visible.
 *  - UsernamePasswordSection: visibility conditions and error surfaces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const STUDENT_ACCOUNT_BASE = {
  profile: {
    id: 1,
    displayName: 'Test student',
    primaryEmail: 'student@example.com',
    cohort: null,
    role: 'student',
    approvalStatus: 'approved',
    createdAt: '2025-01-01T00:00:00Z',
    llmProxyEnabled: false,
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
  externalAccounts: [],
};

/** Account data shaped for admin — no workspace, no cohort. */
const ADMIN_ACCOUNT_BASE = {
  profile: {
    id: 2,
    displayName: 'Test admin',
    primaryEmail: 'admin@example.com',
    cohort: null,
    role: 'admin',
    approvalStatus: 'approved' as const,
    createdAt: '2025-01-01T00:00:00Z',
    llmProxyEnabled: false,
    username: null,
    has_password: false,
  },
  logins: [
    {
      id: 2,
      provider: 'google',
      providerEmail: 'admin@example.com',
      providerUsername: null,
      createdAt: '2025-01-01T00:00:00Z',
    },
  ],
  externalAccounts: [],
};

/** Account data shaped for staff — no workspace, no cohort. */
const STAFF_ACCOUNT_BASE = {
  profile: {
    id: 3,
    displayName: 'Test staff',
    primaryEmail: 'staff@example.com',
    cohort: null,
    role: 'staff',
    approvalStatus: 'approved' as const,
    createdAt: '2025-01-01T00:00:00Z',
    llmProxyEnabled: false,
    username: null,
    has_password: false,
  },
  logins: [
    {
      id: 3,
      provider: 'google',
      providerEmail: 'staff@example.com',
      providerUsername: null,
      createdAt: '2025-01-01T00:00:00Z',
    },
  ],
  externalAccounts: [],
};

/** Build a fetch mock that returns appropriate data for each URL.
 *
 * @param includeAccount - When true, /api/account returns the base data merged
 *   with accountOverrides.
 * @param accountOverrides - Deep-merged into the base account data.
 * @param credentialsResponse - Optional override for PATCH /api/account/credentials.
 * @param baseAccount - Base account object to merge into (defaults to STUDENT_ACCOUNT_BASE).
 */
function makeFetch(
  includeAccount = false,
  accountOverrides: Record<string, unknown> = {},
  credentialsResponse?: { status: number; body: unknown },
  baseAccount: typeof STUDENT_ACCOUNT_BASE = STUDENT_ACCOUNT_BASE,
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    // PATCH /api/account/credentials
    if (
      url === '/api/account/credentials' &&
      (init?.method ?? '').toUpperCase() === 'PATCH'
    ) {
      if (credentialsResponse) {
        const { status, body } = credentialsResponse;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 1, username: 'newuser' }),
      };
    }

    // DELETE /api/account/logins/:id
    if (
      /^\/api\/account\/logins\/\d+$/.test(url) &&
      (init?.method ?? '').toUpperCase() === 'DELETE'
    ) {
      return { ok: true, status: 204, json: async () => ({}) };
    }

    if (url === '/api/account' && includeAccount) {
      const data = {
        ...baseAccount,
        ...accountOverrides,
        profile: {
          ...baseAccount.profile,
          ...((accountOverrides.profile as object) ?? {}),
        },
      };
      return {
        ok: true,
        json: async () => data,
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
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    // Page heading should appear — no redirect happened
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('does NOT show Apps zone heading (tile launchpad removed)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /your applications/i })).not.toBeInTheDocument();
  });

  it('shows Profile and Sign-in Methods sections for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    // Wait for the data to load (profile name is only visible after fetch completes)
    await waitFor(() => {
      expect(screen.getByText('Test admin')).toBeInTheDocument();
    });

    expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    expect(screen.queryByText('Services')).not.toBeInTheDocument();
  });

  it('does NOT show Services or ClaudeCode or LLM Proxy sections for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Services')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
  });

  it('renders all three Add-Login buttons for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Pike 13' })).toBeInTheDocument();
  });
});

// ===========================================================================
// Staff
// ===========================================================================

describe('Account page — staff', () => {
  it('renders without redirecting', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });
  });

  it('does NOT show Apps zone for staff (removed in Sprint 020)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('heading', { name: /your applications/i })).not.toBeInTheDocument();
  });

  it('shows Profile and Sign-in Methods sections for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    // Wait for the data to load (profile name is only visible after fetch completes)
    await waitFor(() => {
      expect(screen.getByText('Test staff')).toBeInTheDocument();
    });

    expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    expect(screen.queryByText('Services')).not.toBeInTheDocument();
  });

  it('does NOT show Services or ClaudeCode or LLM Proxy sections for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Services')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
  });

  it('renders all three Add-Login buttons for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Pike 13' })).toBeInTheDocument();
  });
});

// ===========================================================================
// Student — basic rendering
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

  it('does NOT show ServicesSection, ClaudeCodeSection or LLM Proxy for student', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true);

    renderAccount();

    await waitFor(() => {
      const elements = screen.getAllByText('student@example.com');
      expect(elements.length).toBeGreaterThan(0);
    });

    expect(screen.queryByText('Services')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    // LLM Proxy heading should not appear (AccountLlmProxyCard is removed)
    expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// LoginsSection — Add buttons
// ===========================================================================

describe('Account page — LoginsSection Add buttons', () => {
  it('renders Google + GitHub for a fresh student; Pike 13 is hidden for students', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { logins: [] },
      logins: [],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add Pike 13' })).not.toBeInTheDocument();
  });

  it('renders all three Add buttons (incl. Pike 13) for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, { profile: { logins: [] }, logins: [] }, {}, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Pike 13' })).toBeInTheDocument();
  });

  it('hides Add Pike 13 once a Pike 13 login is present; keeps Google + GitHub', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      logins: [
        { id: 1, provider: 'google', providerEmail: 'x@x.com', providerUsername: null, createdAt: '2025-01-01T00:00:00Z' },
        { id: 2, provider: 'github', providerEmail: null, providerUsername: 'ghuser', createdAt: '2025-01-01T00:00:00Z' },
        { id: 3, provider: 'pike13', providerEmail: null, providerUsername: 'pike', createdAt: '2025-01-01T00:00:00Z' },
      ],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // Google and GitHub allow multiple accounts — Add buttons stay visible.
    expect(screen.getByRole('link', { name: /Add Google/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add GitHub/i })).toBeInTheDocument();
    // Pike 13 is one-per-account — Add button is hidden once linked.
    expect(screen.queryByRole('link', { name: /Add Pike 13/i })).not.toBeInTheDocument();
  });

  it('Pike 13 button targets /api/auth/pike13?link=1 (staff/admin context)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch(true, undefined, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    const pike13Link = screen.getByRole('link', { name: 'Add Pike 13' });
    expect(pike13Link).toHaveAttribute('href', '/api/auth/pike13?link=1');
  });
});

// ===========================================================================
// UsernamePasswordSection — visibility
// ===========================================================================

describe('Account page — UsernamePasswordSection visibility', () => {
  it('does NOT render for a user with no username and no password', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.queryByText('Username & Password')).not.toBeInTheDocument();
  });

  it('renders when user has a username', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: 'testuser', has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });
  });

  it('renders when user has a password set (has_password: true)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: true },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });
  });

  it('renders when user has both username and password', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: 'theuser', has_password: true },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });
  });
});

// ===========================================================================
// UsernamePasswordSection — form behaviour
// ===========================================================================

describe('Account page — UsernamePasswordSection form', () => {
  it('shows a client-side error and does NOT call the API when new passwords do not match', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {
      profile: { username: 'testuser', has_password: true },
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });

    // Fill in the form
    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'oldpass' },
    });
    fireEvent.change(screen.getByLabelText(/^new password/i), {
      target: { value: 'newpass1' },
    });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), {
      target: { value: 'newpass2' }, // different!
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('New passwords do not match');
    });

    // API must NOT have been called with credentials
    const credentialsCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/account/credentials' && (init?.method ?? '').toUpperCase() === 'PATCH',
    );
    expect(credentialsCalls).toHaveLength(0);
  });

  it('surfaces "Username already taken" inline on 409 response', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(
      true,
      { profile: { username: 'testuser', has_password: true } },
      { status: 409, body: { error: 'That username is already taken' } },
    );
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'mypassword' },
    });
    // Change the username field so there is a diff to submit
    fireEvent.change(screen.getByLabelText(/^username/i), {
      target: { value: 'takenuser' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Username already taken');
    });
  });

  it('surfaces "Current password is incorrect" inline on 401 response', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(
      true,
      { profile: { username: 'testuser', has_password: true } },
      { status: 401, body: { error: 'Current password is incorrect' } },
    );
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Username & Password')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/current password/i), {
      target: { value: 'wrongpass' },
    });
    fireEvent.change(screen.getByLabelText(/^username/i), {
      target: { value: 'someotheruser' },
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Current password is incorrect');
    });
  });
});

// ===========================================================================
// WorkspaceSection — visibility and content
// ===========================================================================

describe('Account page — WorkspaceSection', () => {
  it('does NOT render WorkspaceSection for a student with no workspace account and non-League email', async () => {
    // STUDENT_ACCOUNT_BASE has student@example.com (not a League email) and no external accounts
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true);

    renderAccount();

    await waitFor(() => {
      const elements = screen.getAllByText('student@example.com');
      expect(elements.length).toBeGreaterThan(0);
    });

    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
  });

  it('does NOT render WorkspaceSection for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    // Admin has no workspace ExternalAccount and a non-League email
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ADMIN_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
  });

  it('does NOT render WorkspaceSection for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    // Staff has no workspace ExternalAccount and a non-League email
    (globalThis as any).fetch = makeFetch(true, {}, undefined, STAFF_ACCOUNT_BASE);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
  });

  it('renders WorkspaceSection with League email for student who has a workspace ExternalAccount', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      externalAccounts: [
        {
          id: 10,
          type: 'workspace',
          status: 'active',
          externalId: 'student@jointheleague.org',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-section')).toBeInTheDocument();
    });

    expect(screen.getByText('League Email')).toBeInTheDocument();
    expect(screen.getByText('student@jointheleague.org')).toBeInTheDocument();
  });

  it('shows temp-password inline when workspaceTempPassword is set', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { workspaceTempPassword: 'TempP@ss123' },
      externalAccounts: [
        {
          id: 10,
          type: 'workspace',
          status: 'active',
          externalId: 'student@jointheleague.org',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-section')).toBeInTheDocument();
    });

    expect(screen.getByText('TempP@ss123')).toBeInTheDocument();
    // The "password:" label text is present as a text node within the hint span
    expect(screen.getByTestId('workspace-section').textContent).toContain('password:');
  });

  it('does NOT show temp-password when workspaceTempPassword is not set', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { workspaceTempPassword: null },
      externalAccounts: [
        {
          id: 10,
          type: 'workspace',
          status: 'active',
          externalId: 'student@jointheleague.org',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-section')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-section').textContent).not.toContain('password:');
  });

  it('renders pending-approval card and hides all other identity sections for a pending student', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { approvalStatus: 'pending' },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('pending-approval-card')).toBeInTheDocument();
    });

    expect(screen.getByText(/Waiting for approval/i)).toBeInTheDocument();
    // No identity sections should render while pending.
    expect(screen.queryByText('Sign-in Methods')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add Google/i })).not.toBeInTheDocument();
  });

  it('renders WorkspaceSection for student whose primaryEmail is a League email (no ExternalAccount)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { primaryEmail: 'alice@jointheleague.org' },
      externalAccounts: [],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-section')).toBeInTheDocument();
    });

    // The League email appears in both the profile meta and the workspace section
    const matches = screen.getAllByText('alice@jointheleague.org');
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// LoginsSection — Remove button opens ConfirmDialog (Sprint 025 ticket 001)
// ===========================================================================

/** Account data with TWO logins so canRemove is true and the Remove button is enabled. */
const TWO_LOGIN_ACCOUNT = {
  ...STUDENT_ACCOUNT_BASE,
  logins: [
    {
      id: 1,
      provider: 'google',
      providerEmail: 'student@example.com',
      providerUsername: null,
      createdAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 2,
      provider: 'github',
      providerEmail: null,
      providerUsername: 'ghstudent',
      createdAt: '2025-01-01T00:00:00Z',
    },
  ],
};

describe('Account page — login removal confirmation dialog', () => {
  it('opens a confirm dialog (does NOT immediately delete) when Remove is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // There are two Remove buttons; click the first (Google)
    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    // Dialog should now be visible
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Remove login')).toBeInTheDocument();

    // The DELETE mutation should NOT have been called yet
    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        /\/api\/account\/logins\//.test(url) &&
        (init?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('calls the delete mutation when Confirm is clicked in the dialog', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // Click Remove for Google login (id=1)
    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Confirm the removal
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    // The dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The DELETE should have been called with the correct login id
    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        /\/api\/account\/logins\/1$/.test(url) &&
        (init?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(1);
  });

  it('does NOT call the delete mutation when Cancel is clicked in the dialog', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // Click Remove for Google login
    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Cancel the removal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The dialog should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // No DELETE call should have occurred
    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        /\/api\/account\/logins\//.test(url) &&
        (init?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('closes the dialog without deleting when Escape is pressed', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        /\/api\/account\/logins\//.test(url) &&
        (init?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('closes the dialog without deleting when the overlay is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const fetchMock = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the dialog overlay (the role="dialog" element itself is the overlay)
    fireEvent.click(screen.getByRole('dialog'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const deleteCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        /\/api\/account\/logins\//.test(url) &&
        (init?.method ?? '').toUpperCase() === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(0);
  });

  it('shows the provider name in the confirm dialog message', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, TWO_LOGIN_ACCOUNT);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    const removeButtons = screen.getAllByRole('button', { name: /remove google login/i });
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // The message should name the provider
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Google');
    expect(dialog.textContent).toContain('Add Google');
  });
});
