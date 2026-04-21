import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '../../client/src/components/AppLayout';

// ---- Mock useAuth ----

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

// ---- Helpers ----

function renderLayout() {
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
}

function makeAdminUser(overrides = {}) {
  return {
    id: 1,
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

// ---- Tests ----

describe('AppLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default non-admin user
    mockUseAuth.mockReturnValue({
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
    });
  });

  it('renders sidebar with Account navigation link', () => {
    renderLayout();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('shows Admin link when user has admin role', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides Admin link when user has non-admin role', () => {
    renderLayout();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('displays user name in the top bar', () => {
    renderLayout();
    expect(screen.getByText('Jane Student')).toBeInTheDocument();
  });

  it('renders the Outlet content area (main element exists)', () => {
    renderLayout();
    // The Outlet renders inside a <main> element
    const mainEl = document.querySelector('main');
    expect(mainEl).toBeInTheDocument();
  });

  // ---- Impersonation banner tests ----

  it('shows Directory link when user has role=staff', () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 2,
        email: 'staff@example.com',
        displayName: 'Staff User',
        role: 'staff',
        avatarUrl: null,
        provider: null,
        providerId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText('Directory')).toBeInTheDocument();
  });

  it('hides Directory link when user has non-staff role', () => {
    renderLayout();
    expect(screen.queryByText('Directory')).not.toBeInTheDocument();
  });

  it('shows Audit Log link in admin nav when user has admin role and is on an admin route', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/admin/env']}>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
  });

  it('shows ADMIN_WORKFLOW_NAV items in main sidebar when user is admin and not in admin section', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Provisioning Requests')).toBeInTheDocument();
    expect(screen.getByText('Cohorts')).toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Sync')).toBeInTheDocument();
    expect(screen.getByText('Merge Queue')).toBeInTheDocument();
  });

  it('does not show ADMIN_WORKFLOW_NAV items for non-admin users', () => {
    renderLayout();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Provisioning Requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Cohorts')).not.toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Sync')).not.toBeInTheDocument();
    expect(screen.queryByText('Merge Queue')).not.toBeInTheDocument();
  });

  it('does not show ADMIN_WORKFLOW_NAV items when admin is in /admin/* section', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/admin/env']}>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Provisioning Requests')).not.toBeInTheDocument();
  });

  it('shows ops-only ADMIN_NAV items (not workflow items) when in /admin/* section', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    render(
      <MemoryRouter initialEntries={['/admin/env']}>
        <AppLayout />
      </MemoryRouter>,
    );
    expect(screen.getByText('Environment')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('Logs')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Scheduled Jobs')).toBeInTheDocument();
    expect(screen.getByText('Import/Export')).toBeInTheDocument();
  });

  it('Admin bottom link points to /admin/env', () => {
    mockUseAuth.mockReturnValue({
      user: makeAdminUser(),
      loading: false,
      logout: mockLogout,
    });

    renderLayout();
    const adminLink = screen.getByText('Admin').closest('a');
    expect(adminLink).toHaveAttribute('href', '/admin/env');
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

  // ---- Dropdown tests ----

  it('shows "Log out" in dropdown when not impersonating', () => {
    renderLayout();
    // hover over user area to open dropdown
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
