/**
 * Tests for the overhauled UsersPanel (Sprint 009 T006).
 *
 * Covers:
 *  - Table renders user data
 *  - Name and email cells are links to /admin/users/:id
 *  - Search box filters rows
 *  - Filter dropdown shows "Filter: All" by default; selecting a role filter works
 *  - Sortable column headers toggle sort direction
 *  - Impersonate button works for non-own rows
 *  - Empty-state message when no rows match
 */

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
    cohort: null,
    externalAccountTypes: [],
    createdAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 2,
    email: 'user@example.com',
    displayName: 'Regular User',
    role: 'USER',
    provider: null,
    providers: [],
    cohort: { id: 1, name: 'Spring 2025' },
    externalAccountTypes: ['workspace'],
    createdAt: '2025-02-01T00:00:00Z',
  },
  {
    id: 3,
    email: 'another@example.com',
    displayName: 'Another User',
    role: 'USER',
    provider: 'google',
    providers: [{ provider: 'google' }],
    cohort: { id: 2, name: 'Fall 2025' },
    externalAccountTypes: ['pike13'],
    createdAt: '2025-03-01T00:00:00Z',
  },
];

const SAMPLE_COHORTS = [
  { id: 1, name: 'Spring 2025', google_ou_path: '/Students/Spring2025', createdAt: '2025-01-15T00:00:00Z' },
  { id: 2, name: 'Fall 2025', google_ou_path: '/Students/Fall2025', createdAt: '2025-06-01T00:00:00Z' },
];

// ---- Helpers ----

function renderPanel() {
  return render(
    <MemoryRouter>
      <UsersPanel />
    </MemoryRouter>,
  );
}

function makeFetch(users = SAMPLE_USERS, cohorts = SAMPLE_COHORTS) {
  return vi.fn().mockImplementation((url: string) => {
    if (url === '/api/admin/cohorts') {
      return Promise.resolve({ ok: true, json: async () => cohorts });
    }
    return Promise.resolve({ ok: true, json: async () => users });
  });
}

// ---- Tests ----

describe('UsersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', makeFetch());
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
      expect(impersonateButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not render "Impersonate" button for the current user row', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });
    // Find the row containing "Admin User" and verify no Impersonate button
    const rows = screen.getAllByRole('row');
    const adminRow = rows.find((r) => r.textContent?.includes('Admin User'));
    expect(adminRow).toBeDefined();
    expect(adminRow!.textContent).not.toMatch(/impersonate/i);
  });

  it('calls impersonate endpoint and redirects to home on button click', async () => {
    const mockAssign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: mockAssign },
      writable: true,
    });

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      // impersonate call
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button', { name: /impersonate/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/');
    });
  });

  it('shows alert on impersonate failure', async () => {
    const mockAlert = vi.fn();
    vi.stubGlobal('alert', mockAlert);

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: 'Cannot impersonate admin' }),
      });
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

  // ---- New tests for T006 ----

  it('shows default filter label "Filter: All"', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Filter: All/)).toBeInTheDocument();
    });
  });

  it('renders Name column as link to /admin/users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Regular User' });
      expect(link).toHaveAttribute('href', '/admin/users/2');
    });
  });

  it('renders Email column as link to /admin/users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'user@example.com' });
      expect(link).toHaveAttribute('href', '/admin/users/2');
    });
  });

  it('search box filters visible rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'another' } });

    await waitFor(() => {
      expect(screen.getByText('Another User')).toBeInTheDocument();
      expect(screen.queryByText('Regular User')).not.toBeInTheDocument();
    });
  });

  it('shows "No users match this filter." when search matches nothing', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'xyzzy_no_match' } });

    await waitFor(() => {
      expect(screen.getByText('No users match this filter.')).toBeInTheDocument();
    });
  });

  it('sortable column headers are present', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Cohort')).toBeInTheDocument();
      expect(screen.getByText('Admin')).toBeInTheDocument();
      expect(screen.getByText('Joined')).toBeInTheDocument();
    });
  });

  it('clicking the Name header toggles sort direction', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // Name is the default sort ascending (▲)
    const nameHeader = screen.getByText('Name');
    // After first click (Name is already active), direction should toggle to desc
    fireEvent.click(nameHeader);
    await waitFor(() => {
      // The ▼ indicator should appear in the header
      expect(nameHeader.closest('th')?.textContent).toMatch(/▼/);
    });
  });

  it('filter dropdown opens on click and shows sections', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Filter: All/)).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /Filter: All/i });
    fireEvent.click(dropdownButton);

    await waitFor(() => {
      expect(screen.getByText('Admin & Staff')).toBeInTheDocument();
      expect(screen.getByText('Students')).toBeInTheDocument();
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.getByText('League')).toBeInTheDocument();
      expect(screen.getByText('Pike13')).toBeInTheDocument();
    });
  });

  it('selecting "Students" filter shows only student rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /Filter: All/i });
    fireEvent.click(dropdownButton);

    const studentsOption = screen.getByRole('option', { name: 'Students' });
    fireEvent.click(studentsOption);

    await waitFor(() => {
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.getByText('Regular User')).toBeInTheDocument();
      expect(screen.getByText('Another User')).toBeInTheDocument();
    });
  });

  it('cohort entries appear in filter dropdown when cohorts have google_ou_path', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText(/Filter: All/)).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /Filter: All/i });
    fireEvent.click(dropdownButton);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Spring 2025' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Fall 2025' })).toBeInTheDocument();
    });
  });
});
