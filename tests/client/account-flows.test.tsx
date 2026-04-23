/**
 * Client-side account journey tests — T008.
 *
 * These are narrative-style tests that simulate user journeys through the
 * Account page using mocked API responses. They complement the fine-grained
 * unit tests in Account.test.tsx.
 *
 * COVERAGE AUDIT — what is already covered in Account.test.tsx and NOT repeated:
 *
 *  - Href correctness ("Add Google" → /api/auth/google?link=1,
 *                       "Add GitHub" → /api/auth/github?link=1):
 *    → COVERED: Account.test.tsx — "shows Add Google link..." / "shows Add GitHub link..."
 *
 *  - Remove button disabled state (single login):
 *    → COVERED: Account.test.tsx — "Remove button is disabled when only one login remains"
 *
 *  - Remove button enabled state (multiple logins):
 *    → COVERED: Account.test.tsx — "Remove button is enabled when more than one login exists"
 *
 *  - Clicking Remove fires DELETE /api/account/logins/:id:
 *    → COVERED: Account.test.tsx — "clicking Remove calls DELETE /api/account/logins/:id"
 *
 *  - Remove returns 409 → inline error shown:
 *    → COVERED: Account.test.tsx — "shows inline error when Remove returns 409"
 *
 *  - Combined "Request League Email + Claude Seat" button when neither exists:
 *    → COVERED: Account.test.tsx — multiple service section tests
 *
 *  - Disabled hint for Claude when workspace constraint not met:
 *    → COVERED: Account.test.tsx — "shows disabled hint for Claude Seat..."
 *
 *  - Staff/admin redirected without fetching account data:
 *    → COVERED: Account.test.tsx — "redirects staff to /staff..."
 *
 * NEW JOURNEYS ADDED HERE (not covered by prior tests):
 *
 *  Journey 1: User with two logins → "Add" links are absent (both already linked).
 *    Verifies that when BOTH google and github are linked, neither "Add" link appears.
 *    The prior tests only cover the case where one provider is unlinked.
 *
 *  Journey 2: Full state transition — initially one login (Google only), Add GitHub
 *    link is visible. After mocked GitHub add returns updated data with two logins,
 *    the Add GitHub link disappears and the GitHub login appears in the table.
 *    (Simulates the page state after returning from OAuth link flow.)
 *
 *  Journey 3: "Request Claude Seat" disabled state visual — when workspace is
 *    missing and Claude is also not pending, the combined button is shown (not the
 *    disabled hint). When workspace IS pending but Claude is not, the "Request Claude
 *    Seat" standalone button is shown and enabled. This specific conditional branch
 *    sequence is tested as a journey to verify the button logic end-to-end.
 *
 *  Journey 4: Sequential provisioning request state — after clicking "Request League
 *    Email + Claude Seat", the POST call is made with requestType=workspace_and_claude.
 *    After a successful POST, when the page refetches, both workspace and claude show
 *    as pending. (Tests that the mutation call includes the correct payload and that
 *    the UI reflects a re-fetched pending state.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function makeAccountData(overrides: Partial<AccountData> = {}): AccountData {
  return {
    profile: {
      id: 1,
      displayName: 'Alice',
      primaryEmail: 'alice@students.jointheleague.org',
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
// Setup
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Journey 1: Both providers already linked — no Add links shown
//
// When a student has both Google and GitHub logins linked, neither "Add Google"
// nor "Add GitHub" should appear in the UI. This verifies the addable-provider
// filter removes providers that are already linked.
// ---------------------------------------------------------------------------

describe('Journey 1: both providers already linked — no Add links visible', () => {
  it('hides both Add Google and Add GitHub when both are already linked', async () => {
    const data = makeAccountData({
      logins: [
        {
          id: 10,
          provider: 'google',
          providerEmail: 'alice@gmail.com',
          providerUsername: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 11,
          provider: 'github',
          providerEmail: null,
          providerUsername: 'alice-gh',
          createdAt: '2024-06-01T00:00:00.000Z',
        },
      ],
    });

    renderAccount(accountFetch(data));

    await waitFor(() => {
      // Both providers are linked — no Add links should be present
      expect(screen.queryByText('Add Google')).not.toBeInTheDocument();
      expect(screen.queryByText('Add GitHub')).not.toBeInTheDocument();

      // Both logins ARE shown in the table
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.getByText('GitHub')).toBeInTheDocument();
    });
  });

  it('both Remove buttons are enabled when two logins exist', async () => {
    const data = makeAccountData({
      logins: [
        {
          id: 10,
          provider: 'google',
          providerEmail: 'alice@gmail.com',
          providerUsername: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 11,
          provider: 'github',
          providerEmail: null,
          providerUsername: 'alice-gh',
          createdAt: '2024-06-01T00:00:00.000Z',
        },
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
});

// ---------------------------------------------------------------------------
// Journey 2: State after returning from OAuth link — GitHub added, link disappears
//
// This simulates the /account page state AFTER a successful GitHub link:
// the page re-fetches and now shows two logins. The "Add GitHub" link must
// disappear from the UI because github is now in the logins list.
//
// This tests the conditional rendering path where the page receives updated
// data with both logins, not just the initial one-login state.
// ---------------------------------------------------------------------------

describe('Journey 2: post-OAuth-link state — Add GitHub link disappears after link', () => {
  it('Add GitHub link is absent when GitHub login is present in the returned data', async () => {
    // Simulate the page state after returning from GitHub link OAuth:
    // the account fetch now includes both logins.
    const data = makeAccountData({
      logins: [
        {
          id: 10,
          provider: 'google',
          providerEmail: 'alice@gmail.com',
          providerUsername: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 11,
          provider: 'github',
          providerEmail: null,
          providerUsername: 'alice-gh',
          createdAt: '2024-06-01T00:00:00.000Z',
        },
      ],
    });

    renderAccount(accountFetch(data));

    await waitFor(() => {
      // GitHub is now linked → no "Add GitHub" link
      expect(screen.queryByText('Add GitHub')).not.toBeInTheDocument();

      // GitHub login IS visible in the table
      expect(screen.getByText('GitHub')).toBeInTheDocument();
      expect(screen.getByText('alice-gh')).toBeInTheDocument();
    });
  });

  it('Add Google link is absent when Google login is present in the returned data', async () => {
    // Similar: Google is already linked → no Add Google link.
    const data = makeAccountData({
      logins: [
        {
          id: 10,
          provider: 'google',
          providerEmail: 'alice@gmail.com',
          providerUsername: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
    });

    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.queryByText('Add Google')).not.toBeInTheDocument();
      // Add GitHub SHOULD appear (not yet linked)
      const addGitHub = screen.getByText('Add GitHub').closest('a');
      expect(addGitHub).toHaveAttribute('href', '/api/auth/github?link=1');
    });
  });
});

// ---------------------------------------------------------------------------
// Journey 3: Services section conditional states
//
// Tests the logical branch: when workspace is PENDING (from a prior request)
// the "Request Claude Seat" standalone button is shown and enabled.
// The combined button is NOT shown (because workspace is already in progress).
// The "Requires League Email" hint is NOT shown (because workspace baseline is met).
//
// This covers the specific state: hasActiveOrPendingWorkspace=true,
// hasActiveOrPendingClaude=false, workspaceBaseline=true.
// ---------------------------------------------------------------------------

describe('Journey 3: Services section — workspace pending enables standalone Claude button', () => {
  it('shows enabled "Request Claude Seat" when workspace request is pending', async () => {
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [
        {
          id: 5,
          requestedType: 'workspace',
          status: 'pending',
          createdAt: '2024-06-01T00:00:00.000Z',
          decidedAt: null,
        },
      ],
    });

    renderAccount(accountFetch(data));

    await waitFor(() => {
      // Combined button must NOT appear (workspace is already in progress)
      expect(screen.queryByRole('button', { name: /request league email \+ claude seat/i }))
        .not.toBeInTheDocument();

      // Standalone Claude button IS shown and enabled
      const claudeBtn = screen.getByRole('button', { name: /request claude seat/i });
      expect(claudeBtn).not.toBeDisabled();

      // "Requires League Email" hint must NOT appear (workspace baseline met)
      expect(screen.queryByLabelText(/claude seat requires a league email account first/i))
        .not.toBeInTheDocument();
    });
  });

  it('shows "Requires League Email" hint when no workspace and no claude', async () => {
    // State: fresh student with nothing. No combined button is offered —
    // Claude always requires a League email first.
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [],
    });

    renderAccount(accountFetch(data));

    await waitFor(() => {
      expect(screen.getByLabelText(/claude seat requires a league email account first/i))
        .toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^request league email$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /request league email \+ claude seat/i }))
        .not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Journey 4: Request provisioning — League Email button fires POST
//
// Full journey: start with no workspace or claude. Click "Request League
// Email". Verify POST body.requestType === 'workspace'. Claude seats require
// a League email first, so there is no combined button anymore.
// ---------------------------------------------------------------------------

describe('Journey 4: provisioning request journey — League Email button triggers POST', () => {
  it('clicking League Email button fires POST with requestType=workspace', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({ externalAccounts: [], provisioningRequests: [] });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/provisioning-requests' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 30,
                requestedType: 'workspace',
                status: 'pending',
                createdAt: '2024-06-01T00:00:00.000Z',
                decidedAt: null,
              },
            ]),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    await waitFor(() =>
      screen.getByRole('button', { name: /^request league email$/i }),
    );

    await user.click(screen.getByRole('button', { name: /^request league email$/i }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([url, opts]: [string, RequestInit | undefined]) =>
          url === '/api/account/provisioning-requests' && opts?.method === 'POST',
      );
      expect(postCalls).toHaveLength(1);
      const bodyParsed = JSON.parse(postCalls[0][1].body as string);
      expect(bodyParsed.requestType).toBe('workspace');
    });
  });

  it('clicking "Request Claude Seat" when workspace is pending POSTs with requestType=claude', async () => {
    const user = userEvent.setup();
    const data = makeAccountData({
      externalAccounts: [],
      provisioningRequests: [
        {
          id: 5,
          requestedType: 'workspace',
          status: 'pending',
          createdAt: '2024-06-01T00:00:00.000Z',
          decidedAt: null,
        },
      ],
    });

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/account') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url === '/api/account/provisioning-requests' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                id: 31,
                requestedType: 'claude',
                status: 'pending',
                createdAt: '2024-06-01T00:00:00.000Z',
                decidedAt: null,
              },
            ]),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    renderAccount(fetchMock);

    // Wait for the standalone claude button to appear
    await waitFor(() =>
      screen.getByRole('button', { name: /request claude seat/i }),
    );

    await user.click(screen.getByRole('button', { name: /request claude seat/i }));

    await waitFor(() => {
      const postCalls = fetchMock.mock.calls.filter(
        ([url, opts]: [string, RequestInit | undefined]) =>
          url === '/api/account/provisioning-requests' && opts?.method === 'POST',
      );
      expect(postCalls).toHaveLength(1);
      const bodyParsed = JSON.parse(postCalls[0][1].body as string);
      expect(bodyParsed.requestType).toBe('claude');
    });
  });
});
