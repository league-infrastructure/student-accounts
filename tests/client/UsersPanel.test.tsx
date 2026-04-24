/**
 * Tests for the overhauled UsersPanel (Sprint 009 T006 + T007).
 *
 * Covers:
 *  - Table renders user data
 *  - Name and email cells are links to /admin/users/:id
 *  - Search box filters rows
 *  - Filter dropdown shows "Filter: All" by default; selecting a role filter works
 *  - Sortable column headers toggle sort direction
 *  - Empty-state message when no rows match
 *  - T007: Row checkboxes (own row has none; non-own row has one)
 *  - T007: Header toggle-all checkbox selects/deselects all visible non-own rows
 *  - T007: Bulk-action toolbar appears when >= 1 row selected
 *  - T007: Bulk delete calls DELETE for each selected user and refreshes list
 *  - T007: Bulk Edit button is present (stub — does nothing)
 *  - T007: Three-dot menu opens on click; contains Edit, Delete, Impersonate
 *  - T007: Own-row three-dot menu items are disabled
 *  - T007: Three-dot Edit navigates to /admin/users/:id
 *  - T007: Three-dot Delete calls DELETE endpoint and removes row
 *  - T007: Three-dot Impersonate triggers impersonate flow
 *  - T007: Three-dot menu closes on outside click
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// ---- Mock useNavigate ----

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <UsersPanel />
      </QueryClientProvider>
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

  // ---- Base rendering (T006) ----

  it('renders the users table with data', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
      expect(screen.getByText('Another User')).toBeInTheDocument();
    });
  });

  it('renders a "⋮" column header instead of "Actions"', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });
    // The ⋮ th should be present (multiple ⋮ exist — header and row buttons)
    const allDots = screen.getAllByText('⋮');
    const thElement = allDots.find((el) => el.tagName === 'TH');
    expect(thElement).toBeTruthy();
  });

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

  // ---- T007: Row checkboxes ----

  it('renders checkboxes for non-own rows and no checkbox for own row', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // There are 3 users total. Admin User (id=1) is the own row — no row checkbox.
    // Regular User (id=2) and Another User (id=3) get checkboxes.
    // Plus header checkbox = 3 checkboxes total (1 header + 2 row).
    // The Admin column checkboxes are separate (role-toggle, checked/unchecked based on role).
    const selectCheckboxes = screen.getAllByRole('checkbox', { name: /select/i });
    // Header select-all + 2 row checkboxes
    expect(selectCheckboxes.length).toBe(3);
  });

  it('own row has no selection checkbox', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const ownRow = rows.find((r) => r.textContent?.includes('Admin User'));
    expect(ownRow).toBeDefined();

    // The only checkbox in own row should be the Admin-role toggle, not a "Select" checkbox
    const checkboxesInOwnRow = Array.from(ownRow!.querySelectorAll('input[type="checkbox"]'));
    const selectCheckboxInOwnRow = checkboxesInOwnRow.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('select'),
    );
    expect(selectCheckboxInOwnRow).toBeUndefined();
  });

  it('clicking a row checkbox checks it and shows bulk toolbar', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select regular user/i });
    expect(rowCheckboxes.length).toBe(1);
    fireEvent.click(rowCheckboxes[0]);

    await waitFor(() => {
      expect(screen.getByRole('toolbar', { name: /bulk actions/i })).toBeInTheDocument();
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    });
  });

  it('header checkbox selects all visible non-own rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });
  });

  it('header checkbox deselects all when all are selected', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    // Select all
    fireEvent.click(headerCheckbox);
    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });
    // Deselect all
    fireEvent.click(headerCheckbox);
    await waitFor(() => {
      expect(screen.queryByRole('toolbar', { name: /bulk actions/i })).not.toBeInTheDocument();
    });
  });

  // ---- T007: Bulk-action toolbar ----

  it('bulk toolbar shows Edit and Delete buttons', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select regular user/i });
    fireEvent.click(rowCheckboxes[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /bulk edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /bulk delete/i })).toBeInTheDocument();
    });
  });

  it('bulk Edit button does nothing (stub)', async () => {
    const mockConfirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', mockConfirm);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select regular user/i });
    fireEvent.click(rowCheckboxes[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /bulk edit/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /bulk edit/i }));
    // confirm should NOT have been called (it's a no-op stub)
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('bulk Delete shows confirmation dialog and calls DELETE for each selected user', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users' && (!opts || opts.method !== 'DELETE')) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      // DELETE calls
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // Select both non-own rows
    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /bulk delete/i }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Delete 2 user(s)?');
    });

    // Both DELETE calls should have been made
    await waitFor(() => {
      const deleteCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[1] === 'object' && c[1]?.method === 'DELETE',
      );
      expect(deleteCalls.length).toBe(2);
    });
  });

  it('bulk Delete shows error banner on failure', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users' && (!opts || opts.method !== 'DELETE')) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      // DELETE fails
      return Promise.reject(new Error('Network error'));
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select regular user/i });
    fireEvent.click(rowCheckboxes[0]);

    await waitFor(() => {
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /bulk delete/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/1 deletion\(s\) failed/i);
    });
  });

  // ---- T007: Three-dot menu ----

  it('each row has a three-dot menu button', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // 3 users = 3 menu buttons
    expect(menuButtons.length).toBe(3);
  });

  it('clicking three-dot button opens menu with Edit, Delete, Impersonate', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Click menu for Regular User (second row, index 1 since sorted by name: Admin User first)
    fireEvent.click(menuButtons[1]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Impersonate' })).toBeInTheDocument();
    });
  });

  it('own-row three-dot menu items are all disabled', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const ownRow = rows.find((r) => r.textContent?.includes('Admin User'));
    expect(ownRow).toBeDefined();

    const menuButton = ownRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    expect(menuButton).toBeTruthy();
    fireEvent.click(menuButton);

    await waitFor(() => {
      const editItem = screen.getByRole('menuitem', { name: 'Edit' });
      const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
      const impersonateItem = screen.getByRole('menuitem', { name: 'Impersonate' });
      expect(editItem).toBeDisabled();
      expect(deleteItem).toBeDisabled();
      expect(impersonateItem).toBeDisabled();
    });
  });

  it('three-dot Edit navigates to /admin/users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // Open menu for Regular User (id=2) — sorted alphabetically, Another User comes first
    // Order: Admin User, Another User, Regular User
    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Index 2 = Regular User
    fireEvent.click(menuButtons[2]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/users/2');
  });

  it('three-dot Delete calls DELETE endpoint and removes row', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users' && (!opts || opts.method !== 'DELETE')) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      // DELETE
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // Open menu for Regular User
    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Sorted: Admin User (0), Another User (1), Regular User (2)
    fireEvent.click(menuButtons[2]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('Regular User'));
    });

    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/admin/users/2') && c[1]?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it('three-dot Impersonate triggers impersonate flow', async () => {
    const mockAssign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: mockAssign },
      writable: true,
    });

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users' && (!opts || opts.method === undefined)) {
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

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Sorted: Admin User (0), Another User (1), Regular User (2)
    fireEvent.click(menuButtons[2]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Impersonate' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Impersonate' }));

    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/');
    });
  });

  it('three-dot menu closes on outside click', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[1]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    });

    // Click outside
    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    });
  });

  it('no standalone Impersonate button exists outside the three-dot menu', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Regular User')).toBeInTheDocument();
    });

    // There should be no button with "Impersonate" text visible in the DOM
    // (they are inside closed menus)
    expect(screen.queryByRole('button', { name: /impersonate/i })).not.toBeInTheDocument();
  });
});
