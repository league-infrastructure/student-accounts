/**
 * Tests for AccountPage — T006
 *
 * Tests: loading state, happy-path render, section content, Logins add/remove,
 * Services request buttons, Claude constraint enforcement, staff redirect,
 * error state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Account, { type AccountData } from '../../client/src/pages/Account';

// ---------------------------------------------------------------------------
// Mock AuthContext
// ---------------------------------------------------------------------------

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockAuthReturn,
}));

let mockAuthReturn = {
  user: {
    id: 1,
    email: 'student@example.com',
    displayName: 'Alice',
    role: 'student',
    avatarUrl: null,
    provider: 'google',
    providerId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    linkedProviders: ['google'],
  },
  loading: false,
  login: vi.fn(),
  logout: vi.fn(),
  loginWithCredentials: vi.fn(),
  refresh: vi.fn(),
};

// ---------------------------------------------------------------------------
// Mock useProviderStatus
// ---------------------------------------------------------------------------

vi.mock('../../client/src/hooks/useProviderStatus', () => ({
  useProviderStatus: () => mockProviderStatus,
}));

let mockProviderStatus = {
  github: true,
  google: true,
  pike13: false,
  loading: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderAccount(fetchMock: ReturnType<typeof vi.fn>) {
  globalThis.fetch = fetchMock;
  const qc = makeQueryClient();
  return render(
    <MemoryRouter initialEntries={['/account']}>
      <QueryClientProvider client={qc}>
        <Account />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Build a standard AccountData fixture. */
function makeAccountData(overrides: Partial<AccountData> = {}): AccountData {
  return {
    profile: {
      id: 1,
      displayName: 'Alice',
      primaryEmail: 'alice@example.com',
      cohort: { id: 2, name: 'Spring 2025' },
      role: 'student',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    logins: [
      {
        id: 10,
        provider: 'google',
        providerEmail: 'alice@gmail.com',
        providerUsername: null,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    externalAccounts: [],
    provisioningRequests: [],
    ...overrides,
  };
}

/** Fetch mock that resolves GET /api/account with the given data. */
function accountFetch(data: AccountData): ReturnType<typeof vi.fn> {
  return vi.fn((url: string) => {
    if (url === '/api/account') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(data),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderStatus = { github: true, google: true, pike13: false, loading: false };
    mockAuthReturn = {
      user: {
        id: 1,
        email: 'student@example.com',
        displayName: 'Alice',
        role: 'student',
        avatarUrl: null,
        provider: 'google',
        providerId: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        linkedProviders: ['google'],
      },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      loginWithCredentials: vi.fn(),
      refresh: vi.fn(),
    };
  });

  // -------------------------------------------------------------------------
  // 1. Loading state
  // -------------------------------------------------------------------------

  it('renders loading skeleton while query is pending', () => {
    const fetchMock = vi.fn(() => new Promise(() => {})); // never resolves
    renderAccount(fetchMock);

    // Should show an aria-busy loading region
    expect(screen.getByLabelText('Loading account data')).toBeTruthy();
  });

  it('renders aria-busy element during loading', () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    renderAccount(fetchMock);
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Happy-path render — all four sections
  // -------------------------------------------------------------------------

  it('renders all four section headings after data loads', async () => {
    renderAccount(accountFetch(makeAccountData()));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /sign-in methods/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /services/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /help/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Profile section
  // -------------------------------------------------------------------------

  it('shows display name and email in profile section', async () => {
    renderAccount(accountFetch(makeAccountData()));

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });
  });

  it('shows cohort name when cohort is set', async () => {
    renderAccount(accountFetch(makeAccountData()));

    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });
  });

  it('shows "No cohort assigned" when cohort is null', async () => {
    const data = makeAccountData({ profile: { ...makeAccountData().profile, cohort: null } });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.getByText('No cohort assigned')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Logins section — provider listing
  // -------------------------------------------------------------------------

  it('lists all connected providers in the logins table', async () => {
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 11, provider: 'github', providerEmail: null, providerUsername: 'alice-gh', createdAt: '2024-06-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Logins section — Add buttons
  // -------------------------------------------------------------------------

  it('shows Add Google link when google is configured and not yet linked', async () => {
    // logins only has github — google is unlinked
    const data = makeAccountData({
      logins: [
        { id: 11, provider: 'github', providerEmail: null, providerUsername: 'alice-gh', createdAt: '2024-06-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      const link = screen.getByText('Add Google').closest('a');
      expect(link).toHaveAttribute('href', '/api/auth/google?link=1');
    });
  });

  it('shows Add GitHub link when github is configured and not yet linked', async () => {
    // logins only has google — github is unlinked
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      const link = screen.getByText('Add GitHub').closest('a');
      expect(link).toHaveAttribute('href', '/api/auth/github?link=1');
    });
  });

  it('hides Add GitHub when github is not configured', async () => {
    mockProviderStatus = { github: false, google: true, pike13: false, loading: false };
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.queryByText('Add GitHub')).not.toBeInTheDocument();
    });
  });

  it('hides Add Google when google is already linked', async () => {
    // both google and github are configured; google is already linked
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.queryByText('Add Google')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Logins section — Remove button
  // -------------------------------------------------------------------------

  it('Remove button is disabled when only one login remains', async () => {
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      const removeBtn = screen.getByRole('button', { name: /remove google login/i });
      expect(removeBtn).toBeDisabled();
    });
  });

  it('Remove button is enabled when more than one login exists', async () => {
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 11, provider: 'github', providerEmail: null, providerUsername: 'alice-gh', createdAt: '2024-06-01T00:00:00.000Z' },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      const removeGoogle = screen.getByRole('button', { name: /remove google login/i });
      const removeGitHub = screen.getByRole('button', { name: /remove github login/i });
      expect(removeGoogle).not.toBeDisabled();
      expect(removeGitHub).not.toBeDisabled();
    });
  });

  it('clicking Remove calls DELETE /api/account/logins/:id', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 11, provider: 'github', providerEmail: null, providerUsername: 'alice-gh', createdAt: '2024-06-01T00:00:00.000Z' },
      ],
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/logins/11' && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve({}) });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    await waitFor(() => screen.getByRole('button', { name: /remove github login/i }));

    await user.click(screen.getByRole('button', { name: /remove github login/i }));

    await waitFor(() => {
      const deleteCalls = fetchMock.mock.calls.filter(
        ([url, opts]: [string, RequestInit | undefined]) =>
          url === '/api/account/logins/11' && opts?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(1);
    });
  });

  it('shows inline error when Remove returns 409', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({
      logins: [
        { id: 10, provider: 'google', providerEmail: 'alice@gmail.com', providerUsername: null, createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 11, provider: 'github', providerEmail: null, providerUsername: 'alice-gh', createdAt: '2024-06-01T00:00:00.000Z' },
      ],
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/logins/11' && options?.method === 'DELETE') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'Cannot remove the last login' }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    await waitFor(() => screen.getByRole('button', { name: /remove github login/i }));

    await user.click(screen.getByRole('button', { name: /remove github login/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot remove the last login');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Services section — workspace / claude / combined buttons
  // -------------------------------------------------------------------------

  it('shows combined "Request League Email + Claude Seat" button when neither exists', async () => {
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /request league email \+ claude seat/i }),
      ).toBeInTheDocument();
    });
  });

  it('shows "Request League Email" button when no workspace exists but claude is pending', async () => {
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [
        { id: 5, requestedType: 'claude', status: 'pending', createdAt: '2024-06-01T00:00:00.000Z', decidedAt: null },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /request league email$/i })).toBeInTheDocument();
      expect(screen.queryByText(/request league email \+ claude seat/i)).not.toBeInTheDocument();
    });
  });

  it('shows "Request Claude Seat" button (enabled) when workspace baseline met', async () => {
    const data = makeAccountData({
      externalAccounts: [
        { id: 20, type: 'workspace', status: 'active', externalId: 'ws-001', createdAt: '2024-03-01T00:00:00.000Z' },
      ],
      provisioningRequests: [],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /request claude seat/i });
      expect(btn).toBeInTheDocument();
      expect(btn).not.toBeDisabled();
    });
  });

  it('shows disabled hint for Claude Seat when workspace constraint is not met', async () => {
    // No workspace, but claude is not pending either — normally the combined button appears.
    // To test the "requires league email" hint we need: workspace is missing but claude IS pending
    // (so the combined button is hidden, workspace button shows, and claude row shows the hint).
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [
        { id: 5, requestedType: 'claude', status: 'pending', createdAt: '2024-06-01T00:00:00.000Z', decidedAt: null },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      // The Claude row should have a "Requires League Email" hint, not a button
      expect(screen.getByLabelText(/claude seat requires a league email account first/i)).toBeInTheDocument();
    });
  });

  it('Request mutation POSTs workspace_and_claude correctly', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({ externalAccounts: [], provisioningRequests: [] });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/provisioning-requests' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: 30, requestedType: 'workspace', status: 'pending', createdAt: '2024-06-01T00:00:00.000Z', decidedAt: null },
            { id: 31, requestedType: 'claude', status: 'pending', createdAt: '2024-06-01T00:00:00.000Z', decidedAt: null },
          ]),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    await waitFor(() =>
      screen.getByRole('button', { name: /request league email \+ claude seat/i }),
    );

    await user.click(screen.getByRole('button', { name: /request league email \+ claude seat/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, opts]: [string, RequestInit | undefined]) =>
          url === '/api/account/provisioning-requests' && opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const bodyParsed = JSON.parse(postCall![1]!.body as string);
      expect(bodyParsed.requestType).toBe('workspace_and_claude');
    });
  });

  it('shows inline error when provisioning request fails', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({ externalAccounts: [], provisioningRequests: [] });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/provisioning-requests' && options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () => Promise.resolve({ error: 'A workspace request already exists' }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    await waitFor(() =>
      screen.getByRole('button', { name: /request league email \+ claude seat/i }),
    );

    await user.click(screen.getByRole('button', { name: /request league email \+ claude seat/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('A workspace request already exists');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Help section
  // -------------------------------------------------------------------------

  it('renders a mailto link in the Help section', async () => {
    renderAccount(accountFetch(makeAccountData()));

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /admin@jointheleague\.org/i });
      expect(link).toHaveAttribute('href', 'mailto:admin@jointheleague.org');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Staff redirect
  // -------------------------------------------------------------------------

  it('redirects staff to /staff without fetching account data', () => {
    mockAuthReturn = {
      ...mockAuthReturn,
      user: { ...mockAuthReturn.user, role: 'staff' },
    };

    const fetchMock = vi.fn();
    renderAccount(fetchMock);

    // fetch should NOT have been called for /api/account
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account', expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith('/api/account');
  });

  // -------------------------------------------------------------------------
  // 10. Error state
  // -------------------------------------------------------------------------

  it('shows error message and retry button when fetch fails', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal server error' }),
      }),
    );

    renderAccount(fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('error alert shows the server error message', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: 'Service unavailable' }),
      }),
    );

    renderAccount(fetchMock);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // 11. Pending workspace request enables Claude button
  // -------------------------------------------------------------------------

  it('enables Claude Seat button when workspace request is pending', async () => {
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [
        { id: 5, requestedType: 'workspace', status: 'pending', createdAt: '2024-06-01T00:00:00.000Z', decidedAt: null },
      ],
    });
    renderAccount(accountFetch(data));

    await waitFor(() => {
      // workspace is pending → combined button should NOT appear
      // claude row should show an enabled "Request Claude Seat" button
      const claudeBtn = screen.getByRole('button', { name: /request claude seat/i });
      expect(claudeBtn).not.toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // 12. Pike13 row shown as read-only
  // -------------------------------------------------------------------------

  it('shows Pike13 row with "Managed by staff" text', async () => {
    renderAccount(accountFetch(makeAccountData()));

    await waitFor(() => {
      expect(screen.getByText('Managed by staff')).toBeInTheDocument();
    });
  });
});
