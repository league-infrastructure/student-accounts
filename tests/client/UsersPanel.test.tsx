import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UsersPanel from '../../client/src/pages/admin/UsersPanel';

// ---- Mock useAuth ----

const mockUseAuth = vi.fn(() => ({
  user: {
    id: 1,
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'ADMIN',
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  loading: false,
  logout: vi.fn(),
}));

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---- Sample data ----

const SAMPLE_USERS = [
  {
    id: 1,
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'ADMIN',
    provider: 'github',
    providers: [{ provider: 'github' }],
    createdAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    email: 'user@example.com',
    displayName: 'Regular User',
    role: 'USER',
    provider: null,
    providers: [],
    createdAt: '2025-02-01T00:00:00Z',
  },
  {
    id: 3,
    email: 'another@example.com',
    displayName: 'Another User',
    role: 'USER',
    provider: 'google',
    providers: [{ provider: 'google' }],
    createdAt: '2025-03-01T00:00:00Z',
  },
];

// ---- Helpers ----

function renderPanel() {
  return render(
    <MemoryRouter>
      <UsersPanel />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('UsersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_USERS,
      }),
    );
    mockUseAuth.mockReturnValue({
      user: {
        id: 1,
        email: 'admin@example.com',
        displayName: 'Admin User',
        role: 'ADMIN',
        avatarUrl: null,
        provider: null,
        providerId: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      loading: false,
      logout: vi.fn(),
    });
  });

  it('renders the users table with data', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
      expect(screen.getByText('Another User')).toBeInTheDocument();
    });
  });

  it('renders an "Actions" column header', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Actions')).toBeInTheDocument();
    });
  });

  it('renders "Impersonate" button for other users', async () => {
    renderPanel();
    await waitFor(() => {
      const impersonateButtons = screen.getAllByRole('button', { name: /impersonate/i });
      // There are 3 users but 1 is the current admin (id=1), so 2 buttons
      expect(impersonateButtons).toHaveLength(2);
    });
  });

  it('does not render "Impersonate" button for the current user row', async () => {
    renderPanel();
    await waitFor(() => {
      // Admin User (id=1) is the current user — no button in that row
      const rows = screen.getAllByRole('row');
      // rows[0] = header, rows[1] = Admin User, rows[2] = Regular User, rows[3] = Another User
      const adminRow = rows[1];
      expect(adminRow).not.toHaveTextContent('Impersonate');
    });
  });

  it('calls impersonate endpoint and redirects to home on button click', async () => {
    const mockAssign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: mockAssign },
      writable: true,
    });

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => SAMPLE_USERS }) // fetchUsers
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });         // impersonate
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button', { name: /impersonate/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/admin/users/2/impersonate',
        { method: 'POST' },
      );
      expect(mockAssign).toHaveBeenCalledWith('/');
    });
  });

  it('shows alert on impersonate failure', async () => {
    const mockAlert = vi.fn();
    vi.stubGlobal('alert', mockAlert);

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => SAMPLE_USERS })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Cannot impersonate admin' }),
      });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button', { name: /impersonate/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith('Cannot impersonate admin');
    });
  });
});
