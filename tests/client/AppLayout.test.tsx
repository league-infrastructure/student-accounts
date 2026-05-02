import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from '../../client/src/components/AppLayout';

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function withQueryClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

/* ---- Mock useAuth ---- */

const mockLogout = vi.fn();

const mockUseAuth = vi.fn(() => ({
  user: {
    id: 1,
    email: 'student@example.com',
    displayName: 'Jane Student',
    role: 'USER',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  loading: false,
  logout: mockLogout,
}));

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

/* ---- User factories ---- */

function makeStudentUser(overrides = {}) {
  return {
    id: 1,
    email: 'student@example.com',
    displayName: 'Jane Student',
    role: 'USER',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeStaffUser(overrides = {}) {
  return {
    id: 2,
    email: 'staff@example.com',
    displayName: 'Staff User',
    role: 'STAFF',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAdminUser(overrides = {}) {
  return {
    id: 3,
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'ADMIN',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

/* ---- Account data factories ---- */

function makeAccountData(overrides: {
  externalAccounts?: { type: string }[];
  llmProxyEnabled?: boolean;
} = {}) {
  return {
    profile: {
      id: 1,
      email: 'student@example.com',
      displayName: 'Jane Student',
      role: 'USER',
      llmProxyEnabled: overrides.llmProxyEnabled ?? false,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    },
    externalAccounts: overrides.externalAccounts ?? [],
    oauthClients: [],
  };
}

/* ---- Fetch mock helpers ---- */

const originalFetch = globalThis.fetch;

function mockFetchWithAccount(accountData: ReturnType<typeof makeAccountData>) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = vi.fn().mockImplementation(
    (url: string) => {
      if (url === '/api/account') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(accountData),
        });
      }
      // health endpoint used by AppLayout
      if (url === '/api/health') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ appName: 'Test App' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    },
  );
}

function resetFetch() {
  globalThis.fetch = originalFetch;
}

/* ---- Render helpers ---- */

function renderLayout(initialPath = '/') {
  return render(
    withQueryClient(
      <MemoryRouter initialEntries={[initialPath]}>
        <AppLayout />
      </MemoryRouter>,
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('AppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default student user
    mockUseAuth.mockReturnValue({
      user: makeStudentUser(),
      loading: false,
      logout: mockLogout,
    });
  });

  afterEach(() => {
    resetFetch();
  });

  /* ---------------------------------------------------------------- */
  /*  Student role                                                      */
  /* ---------------------------------------------------------------- */

  describe('student role', () => {
    it('sees OAuth Clients in the sidebar', () => {
      renderLayout();
      expect(screen.getByText('OAuth Clients')).toBeInTheDocument();
    });

    it('sees About in the bottom nav', () => {
      renderLayout();
      expect(screen.getByText('About')).toBeInTheDocument();
    });

    it('does not see Account as a sidebar nav link (Account is in user-menu dropdown)', () => {
      renderLayout();
      // "Account" only appears inside the dropdown, not as a sidebar NavLink.
      // The sidebar nav area contains NavLink elements; the dropdown button is
      // only rendered when the user area is clicked.
      const nav = document.querySelector('nav')!;
      // OAuth Clients is a real nav link — check that "Account" is not a nav link
      const navLinks = nav.querySelectorAll('a');
      const accountLink = Array.from(navLinks).find((a) => a.textContent === 'Account');
      expect(accountLink).toBeUndefined();
    });

    it('does not see Services in the sidebar', () => {
      renderLayout();
      expect(screen.queryByRole('link', { name: /^Services$/i })).not.toBeInTheDocument();
    });

    it('does not see User Management group', () => {
      renderLayout();
      expect(screen.queryByText('User Management')).not.toBeInTheDocument();
    });

    it('does not see Admin group', () => {
      renderLayout();
      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });

    it('does not see Dashboard', () => {
      renderLayout();
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });

    it('does not see Sync', () => {
      renderLayout();
      expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    });

    it('does not see Claude Code when account has no claude ExternalAccount', async () => {
      mockFetchWithAccount(makeAccountData({ externalAccounts: [] }));
      renderLayout();
      await waitFor(() => {
        expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
      });
    });

    it('sees Claude Code when account data includes a claude ExternalAccount', async () => {
      mockFetchWithAccount(makeAccountData({ externalAccounts: [{ type: 'claude' }] }));
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText('Claude Code')).toBeInTheDocument();
      });
    });

    it('does not see LLM Proxy when llmProxyEnabled is false', async () => {
      mockFetchWithAccount(makeAccountData({ llmProxyEnabled: false }));
      renderLayout();
      await waitFor(() => {
        expect(screen.queryByText('LLM Proxy')).not.toBeInTheDocument();
      });
    });

    it('sees LLM Proxy when llmProxyEnabled is true', async () => {
      mockFetchWithAccount(makeAccountData({ llmProxyEnabled: true }));
      renderLayout();
      await waitFor(() => {
        expect(screen.getByText('LLM Proxy')).toBeInTheDocument();
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Staff role                                                        */
  /* ---------------------------------------------------------------- */

  describe('staff role', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: makeStaffUser(),
        loading: false,
        logout: mockLogout,
      });
    });

    it('sees OAuth Clients', () => {
      renderLayout();
      expect(screen.getByText('OAuth Clients')).toBeInTheDocument();
    });

    it('sees User Management group header', () => {
      renderLayout();
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('does not see Admin group', () => {
      renderLayout();
      expect(screen.queryByText('Admin')).not.toBeInTheDocument();
    });

    it('does not see Dashboard (admin-only flat item)', () => {
      renderLayout();
      expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    });

    it('does not see Sync (admin-only flat item)', () => {
      renderLayout();
      expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    });

    it('does not show Users (admin-only child) when group is collapsed', () => {
      renderLayout();
      // Group is collapsed at /; Users is an admin-only child anyway
      expect(screen.queryByText('Users')).not.toBeInTheDocument();
    });

    it('does not show Cohorts within User Management (admin-only child)', async () => {
      renderLayout();
      // Click the User Management header to expand it
      fireEvent.click(screen.getByText('User Management'));
      await waitFor(() => {
        // Staff Directory should now be visible; Cohorts should not
        expect(screen.queryByText('Cohorts')).not.toBeInTheDocument();
      });
    });

    it('does not show Groups within User Management (admin-only child)', async () => {
      renderLayout();
      fireEvent.click(screen.getByText('User Management'));
      await waitFor(() => {
        expect(screen.queryByText('Groups')).not.toBeInTheDocument();
      });
    });

    it('shows Staff Directory after expanding User Management group', async () => {
      renderLayout();
      fireEvent.click(screen.getByText('User Management'));
      await waitFor(() => {
        expect(screen.getByText('Staff Directory')).toBeInTheDocument();
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Admin role                                                        */
  /* ---------------------------------------------------------------- */

  describe('admin role', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser(),
        loading: false,
        logout: mockLogout,
      });
    });

    it('sees OAuth Clients', () => {
      renderLayout();
      expect(screen.getByText('OAuth Clients')).toBeInTheDocument();
    });

    it('sees User Management group', () => {
      renderLayout();
      expect(screen.getByText('User Management')).toBeInTheDocument();
    });

    it('sees Dashboard (admin-only flat item)', () => {
      renderLayout();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('sees Sync (admin-only flat item)', () => {
      renderLayout();
      expect(screen.getByText('Sync')).toBeInTheDocument();
    });

    it('sees Admin group', () => {
      renderLayout();
      expect(screen.getByText('Admin')).toBeInTheDocument();
    });

    it('shows all User Management children after expanding the group', async () => {
      renderLayout();
      fireEvent.click(screen.getByText('User Management'));
      await waitFor(() => {
        expect(screen.getByText('Staff Directory')).toBeInTheDocument();
        expect(screen.getByText('Users')).toBeInTheDocument();
        expect(screen.getByText('League Students')).toBeInTheDocument();
        expect(screen.getByText('LLM Proxy Users')).toBeInTheDocument();
        expect(screen.getByText('Cohorts')).toBeInTheDocument();
        expect(screen.getByText('Groups')).toBeInTheDocument();
      });
    });

    it('shows all 8 Admin group children after expanding the group', async () => {
      renderLayout();
      fireEvent.click(screen.getByText('Admin'));
      await waitFor(() => {
        expect(screen.getByText('Audit Log')).toBeInTheDocument();
        expect(screen.getByText('Environment')).toBeInTheDocument();
        expect(screen.getByText('Database')).toBeInTheDocument();
        expect(screen.getByText('Configuration')).toBeInTheDocument();
        expect(screen.getByText('Logs')).toBeInTheDocument();
        expect(screen.getByText('Sessions')).toBeInTheDocument();
        expect(screen.getByText('Scheduled Jobs')).toBeInTheDocument();
        expect(screen.getByText('Import/Export')).toBeInTheDocument();
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  No-morph invariant                                                */
  /* ---------------------------------------------------------------- */

  describe('no-morph invariant', () => {
    it('admin sidebar at /admin/env shows same items as at / (no Back to App, no morph)', () => {
      // At /admin/env the Admin group auto-expands (child active).
      mockUseAuth.mockReturnValue({
        user: makeAdminUser(),
        loading: false,
        logout: mockLogout,
      });

      render(
        withQueryClient(
          <MemoryRouter initialEntries={['/admin/env']}>
            <AppLayout />
          </MemoryRouter>,
        ),
      );

      // All normal sidebar items are still present — sidebar did not swap
      expect(screen.getByText('OAuth Clients')).toBeInTheDocument();
      expect(screen.getByText('User Management')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Sync')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('About')).toBeInTheDocument();

      // No "Back to App" link
      expect(screen.queryByText(/Back to App/i)).not.toBeInTheDocument();
    });

    it('admin sidebar shows admin-ops children (auto-expanded) at /admin/env without hiding other items', () => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser(),
        loading: false,
        logout: mockLogout,
      });

      render(
        withQueryClient(
          <MemoryRouter initialEntries={['/admin/env']}>
            <AppLayout />
          </MemoryRouter>,
        ),
      );

      // Admin group children auto-expand because /admin/env is a child route
      expect(screen.getByText('Environment')).toBeInTheDocument();
      expect(screen.getByText('Database')).toBeInTheDocument();
      expect(screen.getByText('Audit Log')).toBeInTheDocument();

      // Normal non-admin items still present (no morph hiding them)
      expect(screen.getByText('OAuth Clients')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Sync')).toBeInTheDocument();
    });
  });

  /* ---------------------------------------------------------------- */
  /*  User Management group — expand and default-child navigate        */
  /* ---------------------------------------------------------------- */

  describe('User Management group expand / navigate', () => {
    it('clicking User Management header as staff expands the group and shows Staff Directory', async () => {
      mockUseAuth.mockReturnValue({
        user: makeStaffUser(),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();

      // Initially collapsed at /
      expect(screen.queryByText('Staff Directory')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('User Management'));

      await waitFor(() => {
        expect(screen.getByText('Staff Directory')).toBeInTheDocument();
      });
    });

    it('clicking User Management header as admin expands the group and shows all children', async () => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser(),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();

      fireEvent.click(screen.getByText('User Management'));

      await waitFor(() => {
        expect(screen.getByText('Staff Directory')).toBeInTheDocument();
        expect(screen.getByText('Users')).toBeInTheDocument();
        expect(screen.getByText('Cohorts')).toBeInTheDocument();
        expect(screen.getByText('Groups')).toBeInTheDocument();
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /*  User area / dropdown                                              */
  /* ---------------------------------------------------------------- */

  describe('user area and dropdown', () => {
    it('displays the user display name', () => {
      renderLayout();
      expect(screen.getByText('Jane Student')).toBeInTheDocument();
    });

    it('renders the Outlet content area (main element exists)', () => {
      renderLayout();
      expect(document.querySelector('main')).toBeInTheDocument();
    });

    it('does not show impersonation banner when not impersonating', () => {
      renderLayout();
      expect(screen.queryByText(/Viewing as/i)).not.toBeInTheDocument();
    });

    it('shows impersonation banner when user.impersonating is true', () => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser({
          impersonating: true,
          displayName: 'Target User',
          realAdmin: { id: '1', displayName: 'Real Admin' },
        }),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();
      expect(screen.getByText(/Viewing as Target User/i)).toBeInTheDocument();
      expect(screen.getByText(/real admin: Real Admin/i)).toBeInTheDocument();
    });

    it('does not show impersonation banner when impersonating is false', () => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser({ impersonating: false }),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();
      expect(screen.queryByText(/Viewing as/i)).not.toBeInTheDocument();
    });

    it('Account link appears in user-menu dropdown after clicking user area', () => {
      renderLayout();
      // Account should NOT be a sidebar NavLink
      const navLinks = document.querySelector('nav')!.querySelectorAll('a');
      const accountNavLink = Array.from(navLinks).find((a) => a.textContent === 'Account');
      expect(accountNavLink).toBeUndefined();

      // Clicking user area opens the dropdown containing Account
      const userArea = screen.getByText('Jane Student').closest('div[style]')!;
      fireEvent.click(userArea);
      expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
    });

    it('shows "Log out" in dropdown when not impersonating', () => {
      renderLayout();
      const userArea = screen.getByText('Jane Student').closest('div[style]')!;
      fireEvent.click(userArea);
      expect(screen.getByText('Log out')).toBeInTheDocument();
      expect(screen.queryByText('Stop impersonating')).not.toBeInTheDocument();
    });

    it('shows "Stop impersonating" in dropdown instead of "Log out" when impersonating', () => {
      mockUseAuth.mockReturnValue({
        user: makeAdminUser({
          impersonating: true,
          displayName: 'Target User',
          realAdmin: { id: '1', displayName: 'Real Admin' },
        }),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();
      const userArea = screen.getByText('Target User').closest('div[style]')!;
      fireEvent.click(userArea);
      expect(screen.getByText('Stop impersonating')).toBeInTheDocument();
      expect(screen.queryByText('Log out')).not.toBeInTheDocument();
    });

    it('calls stop-impersonating endpoint and reloads when "Stop impersonating" is clicked', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true });
      const mockReload = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: mockReload },
        writable: true,
      });

      mockUseAuth.mockReturnValue({
        user: makeAdminUser({
          impersonating: true,
          displayName: 'Target User',
          realAdmin: { id: '1', displayName: 'Real Admin' },
        }),
        loading: false,
        logout: mockLogout,
      });

      renderLayout();
      const userArea = screen.getByText('Target User').closest('div[style]')!;
      fireEvent.click(userArea);

      const stopBtn = screen.getByText('Stop impersonating');
      fireEvent.click(stopBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/stop-impersonating',
          { method: 'POST' },
        );
        expect(mockReload).toHaveBeenCalled();
      });

      vi.unstubAllGlobals();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  hasStaffAccess unit tests (retained from previous test file)       */
/* ------------------------------------------------------------------ */

import { hasStaffAccess } from '../../client/src/lib/roles';

describe('hasStaffAccess', () => {
  it("returns true for 'staff'", () => {
    expect(hasStaffAccess('staff')).toBe(true);
  });

  it("returns true for 'admin' (lowercase)", () => {
    expect(hasStaffAccess('admin')).toBe(true);
  });

  it("returns true for 'STAFF' (uppercase, from server serialization)", () => {
    expect(hasStaffAccess('STAFF')).toBe(true);
  });

  it("returns true for 'ADMIN' (uppercase, from server serialization)", () => {
    expect(hasStaffAccess('ADMIN')).toBe(true);
  });

  it("returns false for 'student'", () => {
    expect(hasStaffAccess('student')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(hasStaffAccess(undefined)).toBe(false);
  });
});
