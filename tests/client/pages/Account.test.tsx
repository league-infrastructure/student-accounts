/**
 * Tests for the Account page — Sprint 020 (post tile-launchpad removal).
 *
 * Covers:
 *  - Admin: renders without redirecting; no tile sections.
 *  - Staff: renders without redirecting; no tile sections.
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

/** Build a fetch mock that returns appropriate data for each URL. */
function makeFetch(
  includeStudentAccount = false,
  accountOverrides: Record<string, unknown> = {},
  credentialsResponse?: { status: number; body: unknown },
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

    if (url === '/api/account' && includeStudentAccount) {
      const data = {
        ...STUDENT_ACCOUNT_BASE,
        ...accountOverrides,
        profile: {
          ...STUDENT_ACCOUNT_BASE.profile,
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

  it('does NOT show Services or ClaudeCode or LLM Proxy sections for admin', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Services')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
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

  it('does NOT show Services or ClaudeCode or LLM Proxy sections for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByText('Services')).not.toBeInTheDocument();
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
    expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
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
  it('renders all three Add buttons when integrations are configured and user has no logins', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { logins: [] },
      logins: [],
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByText('Sign-in Methods')).toBeInTheDocument();
    });

    // All three buttons should be present
    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Pike 13' })).toBeInTheDocument();
  });

  it('renders all three Add buttons even when user already has all three linked', async () => {
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

    // All three Add buttons should still be visible
    expect(screen.getByRole('link', { name: 'Add Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add Pike 13' })).toBeInTheDocument();
  });

  it('Pike 13 button targets /api/auth/pike13?link=1', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true);

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
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
    });

    expect(screen.queryByTestId('workspace-section')).not.toBeInTheDocument();
  });

  it('does NOT render WorkspaceSection for staff', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    (globalThis as any).fetch = makeFetch();

    renderAccount();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /my account/i })).toBeInTheDocument();
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

  it('renders pending-approval banner for a pending student', async () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    (globalThis as any).fetch = makeFetch(true, {
      profile: { approvalStatus: 'pending' },
    });

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-section')).toBeInTheDocument();
    });

    expect(screen.getByRole('status')).toHaveTextContent('pending approval');
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
