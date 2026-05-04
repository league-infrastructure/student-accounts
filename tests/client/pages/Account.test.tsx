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
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

// ===========================================================================
// Send-test button (Sprint 028 ticket 003)
// ===========================================================================

/**
 * Account data with two available emails so the NotificationEmailPicker
 * renders as a clickable button (not a flat div).  The Send-test button
 * is in ProfileSection regardless, but this fixture keeps it realistic.
 */
const MULTI_EMAIL_ACCOUNT = {
  ...STUDENT_ACCOUNT_BASE,
  profile: {
    ...STUDENT_ACCOUNT_BASE.profile,
    notificationEmail: 'alt@example.com',
    availableEmails: ['student@example.com', 'alt@example.com'],
  },
};

describe('Account page — Send-test button', () => {
  it('renders a "Send test" button in the profile section', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, MULTI_EMAIL_ACCOUNT);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });
  });

  it('POSTs to /api/account/test-email with the current notification email on click', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/account' ) {
        return {
          ok: true,
          json: async () => ({
            ...MULTI_EMAIL_ACCOUNT,
            profile: { ...MULTI_EMAIL_ACCOUNT.profile },
          }),
        };
      }
      if (url === '/api/account/test-email') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messageId: 'abc', to: 'alt@example.com' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send test email/i }));

    await waitFor(() => {
      const testEmailCalls = fetchMock.mock.calls.filter(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/account/test-email' &&
          (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(testEmailCalls).toHaveLength(1);
      const body = JSON.parse(testEmailCalls[0][1]!.body as string);
      expect(body.to).toBe('alt@example.com');
    });
  });

  it('shows a green success pill after a successful test-email POST', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...MULTI_EMAIL_ACCOUNT }) };
      }
      if (url === '/api/account/test-email') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messageId: 'abc', to: 'alt@example.com' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send test email/i }));

    await waitFor(() => {
      const pill = screen.getByTestId('test-email-pill');
      expect(pill).toBeInTheDocument();
      expect(pill.textContent).toContain('Test email sent to alt@example.com');
    });

    // Pill should be styled green
    const pill = screen.getByTestId('test-email-pill');
    expect(pill).toHaveStyle({ color: '#065f46' });
  });

  it('shows a red error pill when the test-email POST returns an error', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...MULTI_EMAIL_ACCOUNT }) };
      }
      if (url === '/api/account/test-email') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'SMTP not configured' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /send test email/i }));

    await waitFor(() => {
      const pill = screen.getByTestId('test-email-pill');
      expect(pill).toBeInTheDocument();
      expect(pill.textContent).toContain('SMTP not configured');
    });

    // Pill should be styled red
    const pill = screen.getByTestId('test-email-pill');
    expect(pill).toHaveStyle({ color: '#991b1b' });
  });

  it('disables the button while the POST is in-flight', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    // Fetch that never resolves for the test-email endpoint
    let resolveTestEmail!: (v: unknown) => void;
    const testEmailPromise = new Promise((resolve) => {
      resolveTestEmail = resolve;
    });

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...MULTI_EMAIL_ACCOUNT }) };
      }
      if (url === '/api/account/test-email') {
        return testEmailPromise;
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });

    const btn = screen.getByRole('button', { name: /send test email/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);

    // Button should become disabled while in-flight
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeDisabled();
    });

    // Resolve the pending promise so the component can clean up
    act(() => {
      resolveTestEmail({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, messageId: 'x', to: 'alt@example.com' }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).not.toBeDisabled();
    });
  });

  it('pill disappears after 5 seconds', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...MULTI_EMAIL_ACCOUNT }) };
      }
      if (url === '/api/account/test-email') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messageId: 'abc', to: 'alt@example.com' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderAccount();

    // Wait for the button to appear (account data loaded)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
    });

    // Switch to fake timers after initial async setup completes
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /send test email/i }));

      // Fetch mock resolves asynchronously — flush promises
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Pill should now be visible
      expect(screen.getByTestId('test-email-pill')).toBeInTheDocument();

      // Advance clock past the 5 s auto-clear
      await act(async () => {
        vi.advanceTimersByTime(5001);
      });

      expect(screen.queryByTestId('test-email-pill')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ===========================================================================
// AddCredentials button + modal (Sprint 028 ticket 015)
// ===========================================================================

describe('Account page — Add username/password button', () => {
  it('shows "Add username/password" button when user has no username and no password', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /add username\/password/i }),
    ).toBeInTheDocument();
  });

  it('hides the button when user already has both username and password', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: 'theuser', has_password: true },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: /add username\/password/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the button when user has only a username (partial credentials)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: 'theuser', has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // hasCredentials = true when username is set, so button is hidden
    expect(
      screen.queryByRole('button', { name: /add username\/password/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the button when user has only a password (no username)', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: true },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // hasCredentials = true when has_password is set, so button is hidden
    expect(
      screen.queryByRole('button', { name: /add username\/password/i }),
    ).not.toBeInTheDocument();
  });

  it('opens the AddCredentials modal when button is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add username\/password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /add username\/password/i }));

    expect(screen.getByRole('dialog', { name: /add username and password/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('closes the modal when Cancel is clicked', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add username\/password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /add username\/password/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add username and password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /add username and password/i })).not.toBeInTheDocument();
    });
  });

  it('submits PATCH /api/account/credentials with username + newPassword (no currentPassword) on submit', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/account') {
        return {
          ok: true,
          json: async () => ({
            ...STUDENT_ACCOUNT_BASE,
            profile: { ...STUDENT_ACCOUNT_BASE.profile, username: null, has_password: false },
          }),
        };
      }
      if (
        url === '/api/account/credentials' &&
        (init?.method ?? '').toUpperCase() === 'PATCH'
      ) {
        return { ok: true, status: 200, json: async () => ({ id: 1, username: 'newuser' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add username\/password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /add username\/password/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add username and password/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByLabelText(/^password \*/i), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /set credentials/i }));

    await waitFor(() => {
      const credCalls = fetchMock.mock.calls.filter(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/account/credentials' &&
          (init?.method ?? '').toUpperCase() === 'PATCH',
      );
      expect(credCalls).toHaveLength(1);
      const body = JSON.parse(credCalls[0][1]!.body as string);
      expect(body.username).toBe('newuser');
      expect(body.newPassword).toBe('secret123');
      // Must NOT include currentPassword in the first-time path
      expect(body.currentPassword).toBeUndefined();
    });
  });

  it('closes modal and invalidates [account] query on success', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    let accountCallCount = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/account') {
        accountCallCount++;
        return {
          ok: true,
          json: async () => ({
            ...STUDENT_ACCOUNT_BASE,
            profile: { ...STUDENT_ACCOUNT_BASE.profile, username: null, has_password: false },
          }),
        };
      }
      if (
        url === '/api/account/credentials' &&
        (init?.method ?? '').toUpperCase() === 'PATCH'
      ) {
        return { ok: true, status: 200, json: async () => ({ id: 1, username: 'newuser' }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add username\/password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /add username\/password/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add username and password/i })).toBeInTheDocument();
    });

    const callCountBeforeSubmit = accountCallCount;

    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'newuser' } });
    fireEvent.change(screen.getByLabelText(/^password \*/i), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'secret123' } });

    fireEvent.click(screen.getByRole('button', { name: /set credentials/i }));

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /add username and password/i })).not.toBeInTheDocument();
    });

    // Account query should have been re-fetched at least once more after submit
    await waitFor(() => {
      expect(accountCallCount).toBeGreaterThan(callCountBeforeSubmit);
    });
  });

  it('shows an inline error when passwords do not match', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { username: null, has_password: false },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add username\/password/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /add username\/password/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /add username and password/i })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/^username/i), { target: { value: 'user1' } });
    fireEvent.change(screen.getByLabelText(/^password \*/i), { target: { value: 'aaa' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'bbb' } });

    fireEvent.click(screen.getByRole('button', { name: /set credentials/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
    });
  });
});

// ===========================================================================
// CompleteProfileSection — onboarding gate (Sprint 028 ticket 016)
// ===========================================================================

/**
 * Account data with onboarding_completed = false.
 * displayName is null (new user) and primaryEmail is pre-filled.
 */
const ONBOARDING_ACCOUNT = {
  ...STUDENT_ACCOUNT_BASE,
  profile: {
    ...STUDENT_ACCOUNT_BASE.profile,
    displayName: null,
    primaryEmail: 'newstudent@example.com',
    onboarding_completed: false,
  },
};

describe('Account page — onboarding gate (CompleteProfileSection)', () => {
  it('renders the complete-profile form and hides normal sections when onboarding_completed is false', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ONBOARDING_ACCOUNT as any);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    // The form heading should be visible
    expect(screen.getByText('Complete your profile')).toBeInTheDocument();

    // Normal sections must be absent
    expect(screen.queryByText('Sign-in Methods')).not.toBeInTheDocument();
    expect(screen.queryByText('Help & Contact')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
  });

  it('pre-fills full-name field with existing displayName when available', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    const accountWithName = {
      ...ONBOARDING_ACCOUNT,
      profile: { ...ONBOARDING_ACCOUNT.profile, displayName: 'Jane Doe' },
    };
    (globalThis as any).fetch = makeFetch(true, {}, undefined, accountWithName as any);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    const nameInput = screen.getByLabelText(/full name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Jane Doe');
  });

  it('pre-fills email field with primaryEmail', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ONBOARDING_ACCOUNT as any);

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    const emailInput = screen.getByLabelText(/email address/i) as HTMLInputElement;
    expect(emailInput.value).toBe('newstudent@example.com');
  });

  it('POSTs the correct body to /api/account/complete-onboarding on submit', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/account') {
        // First call returns onboarding incomplete; subsequent calls return completed
        const callCount = fetchMock.mock.calls.filter(([u]: [string]) => u === '/api/account').length;
        if (callCount <= 1) {
          return { ok: true, json: async () => ({ ...ONBOARDING_ACCOUNT }) };
        }
        return {
          ok: true,
          json: async () => ({
            ...STUDENT_ACCOUNT_BASE,
            profile: { ...STUDENT_ACCOUNT_BASE.profile, onboarding_completed: true, displayName: 'Alice Smith' },
          }),
        };
      }
      if (url === '/api/account/complete-onboarding') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      const onboardingCalls = fetchMock.mock.calls.filter(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === '/api/account/complete-onboarding' &&
          (init?.method ?? '').toUpperCase() === 'POST',
      );
      expect(onboardingCalls).toHaveLength(1);
      const body = JSON.parse(onboardingCalls[0][1]!.body as string);
      expect(body.displayName).toBe('Alice Smith');
      expect(body.email).toBe('alice@example.com');
    });
  });

  it('invalidates [account] on success so the page re-renders without the gate', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    let callIndex = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/account') {
        callIndex++;
        if (callIndex === 1) {
          return { ok: true, json: async () => ({ ...ONBOARDING_ACCOUNT }) };
        }
        // After onboarding, return completed profile
        return {
          ok: true,
          json: async () => ({
            ...STUDENT_ACCOUNT_BASE,
            profile: { ...STUDENT_ACCOUNT_BASE.profile, onboarding_completed: true, displayName: 'Alice Smith' },
          }),
        };
      }
      if (url === '/api/account/complete-onboarding') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Alice Smith' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'alice@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    // After success, the gate should disappear and normal sections appear
    await waitFor(() => {
      expect(screen.queryByTestId('complete-profile-section')).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });
  });

  it('shows a validation error when name is empty and does not POST', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...ONBOARDING_ACCOUNT }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    // Clear the name field
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Full name is required.');
    });

    const onboardingCalls = fetchMock.mock.calls.filter(
      ([url, init]: [string, RequestInit | undefined]) =>
        url === '/api/account/complete-onboarding' &&
        (init?.method ?? '').toUpperCase() === 'POST',
    );
    expect(onboardingCalls).toHaveLength(0);
  });

  it('shows an API error inline when the POST fails', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });

    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/account') {
        return { ok: true, json: async () => ({ ...ONBOARDING_ACCOUNT }) };
      }
      if (url === '/api/account/complete-onboarding') {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'displayName must be a non-empty string' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = fetchMock;

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Bob Jones' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'bob@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('displayName must be a non-empty string');
    });
  });

  it('page header is visible during onboarding gate', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {}, undefined, ONBOARDING_ACCOUNT as any);

    renderAccount();

    // Wait for data to load (complete-profile-section appears only after data loads)
    await waitFor(() => {
      expect(screen.getByTestId('complete-profile-section')).toBeInTheDocument();
    });

    // The page header must also be present
    expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
  });
});
