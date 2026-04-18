import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Account from '../../client/src/pages/Account';

// ---- Mock AuthContext ----

const mockRefresh = vi.fn();

function makeAuthUser(overrides: Partial<{
  linkedProviders: string[];
  provider: string | null;
}> = {}) {
  return {
    id: 1,
    email: 'user@example.com',
    displayName: 'Test User',
    role: 'user',
    avatarUrl: null,
    provider: overrides.provider ?? null,
    providerId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    linkedProviders: overrides.linkedProviders ?? [],
  };
}

let mockUser = makeAuthUser();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    loginWithCredentials: vi.fn(),
    refresh: mockRefresh,
  }),
}));

// ---- Mock useProviderStatus ----

let mockProviderStatus = {
  github: true,
  google: true,
  pike13: true,
  loading: false,
};

vi.mock('../../client/src/hooks/useProviderStatus', () => ({
  useProviderStatus: () => mockProviderStatus,
}));

// ---- Mock lib/roles ----

vi.mock('../../client/src/lib/roles', () => ({
  roleBadgeStyle: () => ({ background: '#e0e7ff', color: '#3730a3' }),
  roleShortLabel: (role: string) => role,
}));

// ---- Helpers ----

function renderAccount() {
  return render(
    <MemoryRouter>
      <Account />
    </MemoryRouter>,
  );
}

/** Build a fetch mock that handles /api/auth/unlink/:provider */
function mockFetchUnlink(provider: string, response: { ok: boolean; body?: object }) {
  globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url === `/api/auth/unlink/${provider}` && options?.method === 'POST') {
      return Promise.resolve({
        ok: response.ok,
        json: () => Promise.resolve(response.body ?? {}),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

// ---- Tests ----

describe('Account — Sign-in methods section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderStatus = { github: true, google: true, pike13: true, loading: false };
    mockRefresh.mockResolvedValue(undefined);
  });

  describe('Add buttons', () => {
    it('shows Add buttons for all three providers when user has no linked providers', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      expect(screen.getByText('Add GitHub')).toBeInTheDocument();
      expect(screen.getByText('Add Google')).toBeInTheDocument();
      expect(screen.getByText('Add Pike 13')).toBeInTheDocument();
    });

    it('shows "No OAuth providers linked." message when no providers linked', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();
      expect(screen.getByText('No OAuth providers linked.')).toBeInTheDocument();
    });

    it('shows Add buttons only for unlinked providers when user has github linked', () => {
      mockUser = makeAuthUser({ linkedProviders: ['github'] });
      renderAccount();

      expect(screen.queryByText('Add GitHub')).not.toBeInTheDocument();
      expect(screen.getByText('Add Google')).toBeInTheDocument();
      expect(screen.getByText('Add Pike 13')).toBeInTheDocument();
    });

    it('shows no Add buttons when only GitHub is globally configured and it is already linked', () => {
      mockProviderStatus = { github: true, google: false, pike13: false, loading: false };
      mockUser = makeAuthUser({ linkedProviders: ['github'] });
      renderAccount();

      expect(screen.queryByText(/Add/)).not.toBeInTheDocument();
    });

    it('does not show Add buttons for providers not globally configured', () => {
      mockProviderStatus = { github: true, google: false, pike13: false, loading: false };
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      expect(screen.getByText('Add GitHub')).toBeInTheDocument();
      expect(screen.queryByText('Add Google')).not.toBeInTheDocument();
      expect(screen.queryByText('Add Pike 13')).not.toBeInTheDocument();
    });

    it('Add GitHub link navigates to /api/auth/github?link=1', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      const link = screen.getByText('Add GitHub').closest('a');
      expect(link).toHaveAttribute('href', '/api/auth/github?link=1');
    });

    it('Add Google link navigates to /api/auth/google?link=1', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      const link = screen.getByText('Add Google').closest('a');
      expect(link).toHaveAttribute('href', '/api/auth/google?link=1');
    });

    it('Add Pike 13 link navigates to /api/auth/pike13?link=1', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      const link = screen.getByText('Add Pike 13').closest('a');
      expect(link).toHaveAttribute('href', '/api/auth/pike13?link=1');
    });
  });

  describe('Unlink buttons', () => {
    it('shows Unlink button for linked provider', () => {
      mockUser = makeAuthUser({ linkedProviders: ['github'] });
      renderAccount();

      expect(screen.getByRole('button', { name: /unlink github/i })).toBeInTheDocument();
    });

    it('Unlink button is disabled when user has only one linked provider', () => {
      mockUser = makeAuthUser({ linkedProviders: ['github'] });
      renderAccount();

      const btn = screen.getByRole('button', { name: /unlink github/i });
      expect(btn).toBeDisabled();
    });

    it('both Unlink buttons are enabled when user has two linked providers', () => {
      mockUser = makeAuthUser({ linkedProviders: ['github', 'google'] });
      renderAccount();

      const githubBtn = screen.getByRole('button', { name: /unlink github/i });
      const googleBtn = screen.getByRole('button', { name: /unlink google/i });
      expect(githubBtn).not.toBeDisabled();
      expect(googleBtn).not.toBeDisabled();
    });

    it('clicking Unlink POSTs to /api/auth/unlink/:provider', async () => {
      mockUser = makeAuthUser({ linkedProviders: ['github', 'google'] });
      mockFetchUnlink('github', { ok: true });
      const user = userEvent.setup();

      renderAccount();

      const btn = screen.getByRole('button', { name: /unlink github/i });
      await user.click(btn);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/auth/unlink/github', { method: 'POST' });
      });
    });

    it('calls refresh() after successful unlink', async () => {
      mockUser = makeAuthUser({ linkedProviders: ['github', 'google'] });
      mockFetchUnlink('github', { ok: true });
      const user = userEvent.setup();

      renderAccount();

      await user.click(screen.getByRole('button', { name: /unlink github/i }));

      await waitFor(() => {
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });
    });

    it('shows error message when unlink returns non-OK response (409)', async () => {
      mockUser = makeAuthUser({ linkedProviders: ['github', 'google'] });
      mockFetchUnlink('github', {
        ok: false,
        body: { error: 'Cannot unlink your only login method' },
      });
      const user = userEvent.setup();

      renderAccount();

      await user.click(screen.getByRole('button', { name: /unlink github/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Cannot unlink your only login method',
        );
      });
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('shows generic error when unlink response has no error field', async () => {
      mockUser = makeAuthUser({ linkedProviders: ['github', 'google'] });
      mockFetchUnlink('github', { ok: false, body: {} });
      const user = userEvent.setup();

      renderAccount();

      await user.click(screen.getByRole('button', { name: /unlink github/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to unlink provider');
      });
    });
  });

  describe('Section visibility', () => {
    it('Sign-in methods heading is visible', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();
      expect(screen.getByRole('heading', { name: /sign-in methods/i })).toBeInTheDocument();
    });

    it('existing account info fields are still rendered', () => {
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      expect(screen.getByText('Test User')).toBeInTheDocument();
      expect(screen.getByText('user@example.com')).toBeInTheDocument();
    });

    it('Add section is absent when no providers are globally configured', () => {
      mockProviderStatus = { github: false, google: false, pike13: false, loading: false };
      mockUser = makeAuthUser({ linkedProviders: [] });
      renderAccount();

      expect(screen.queryByText(/Add/)).not.toBeInTheDocument();
    });
  });
});
