/**
 * Tests for AdminUsersPanel — /admin/users (Sprint 024 T002).
 *
 * Covers:
 *  - Renders all users (not filtered to staff)
 *  - Name and email cells are links to /users/:id
 *  - Search bar filters by name or email (client-side, real-time)
 *  - Filter dropdown supports All / Admin & Staff / Students / by account
 *    type / by cohort
 *  - Column headers Name, Email, Cohort, Accounts, Joined are all sortable
 *  - Row action menu includes Edit, Delete, Impersonate
 *  - Make admin / Remove admin toggle appears only on STAFF/ADMIN rows
 *  - Self-demotion button is disabled
 *  - Last-admin demotion button is disabled
 *  - Bulk selection and bulk delete work as before
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminUsersPanel from '../../client/src/pages/admin/AdminUsersPanel';

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
    email: 'staff@example.com',
    displayName: 'Staff User',
    role: 'STAFF',
    provider: null,
    providers: [],
    cohort: null,
    externalAccountTypes: [],
    createdAt: '2025-02-01T00:00:00Z',
  },
  {
    id: 3,
    email: 'student@example.com',
    displayName: 'Student User',
    role: 'USER',
    provider: null,
    providers: [],
    cohort: { id: 1, name: 'Spring 2025' },
    externalAccountTypes: [],
    createdAt: '2025-03-01T00:00:00Z',
  },
];

const SAMPLE_COHORTS = [
  { id: 1, name: 'Spring 2025', google_ou_path: '/Students/Spring2025' },
  { id: 2, name: 'Fall 2025', google_ou_path: '/Students/Fall2025' },
];

// ---- Helpers ----

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminUsersPanel />
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

describe('AdminUsersPanel', () => {
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

  // ---- All-users rendering ----

  it('renders all users (not filtered to staff)', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });
  });

  it('renders the "Users" heading', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    });
  });

  it('renders a "⋮" column header', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });
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

  it('renders Name column as link to /users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'Student User' });
      expect(link).toHaveAttribute('href', '/users/3');
    });
  });

  it('renders Email column as link to /users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      const link = screen.getByRole('link', { name: 'student@example.com' });
      expect(link).toHaveAttribute('href', '/users/3');
    });
  });

  // ---- Search bar ----

  it('search box filters visible rows by name', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'student' } });

    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
    });
  });

  it('search box filters visible rows by email', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'staff@example' } });

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('shows "No users match this filter." when search matches nothing', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'xyzzy_no_match' } });

    await waitFor(() => {
      expect(screen.getByText('No users match this filter.')).toBeInTheDocument();
    });
  });

  // ---- Sortable headers ----

  it('renders all sortable column headers: Name, Email, Cohort, Accounts, Joined', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Cohort')).toBeInTheDocument();
      expect(screen.getByText('Accounts')).toBeInTheDocument();
      expect(screen.getByText('Joined')).toBeInTheDocument();
    });
  });

  it('clicking the Name header sorts ascending', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // Default sort is Joined desc. Click Name to sort by name asc.
    const nameHeader = screen.getByText('Name');
    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(nameHeader.closest('th')?.textContent).toMatch(/▲/);
    });
  });

  it('clicking the Joined header twice sorts descending then ascending', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // Default sort is already Joined desc (▼ indicator present)
    const joinedHeader = screen.getByText('Joined');
    expect(joinedHeader.closest('th')?.textContent).toMatch(/▼/);

    // Click to flip to asc
    fireEvent.click(joinedHeader);
    await waitFor(() => {
      expect(joinedHeader.closest('th')?.textContent).toMatch(/▲/);
    });
  });

  it('sorts by Joined desc by default (most-recent-first)', async () => {
    // Students joined: admin Jan, staff Feb, student Mar.
    // Desc order should be: Student User, Staff User, Admin User
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row').slice(1); // skip header
    const names = rows.map((r) => {
      const link = r.querySelector('a');
      return link?.textContent ?? '';
    });
    expect(names[0]).toBe('Student User');
    expect(names[1]).toBe('Staff User');
    expect(names[2]).toBe('Admin User');
  });

  // ---- Filter dropdown ----

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

  it('selecting "Students" filter hides admin and staff rows', async () => {
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
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });
  });

  it('selecting "Admin & Staff" filter hides student rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const dropdownButton = screen.getByRole('button', { name: /Filter: All/i });
    fireEvent.click(dropdownButton);

    const adminStaffOption = screen.getByRole('option', { name: 'Admin & Staff' });
    fireEvent.click(adminStaffOption);

    await waitFor(() => {
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Staff User')).toBeInTheDocument();
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

  // ---- Row checkboxes + bulk actions ----

  it('renders checkboxes for non-own rows and no checkbox for own row', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // 3 users. Admin User (id=1) is the own row — no row checkbox.
    // Staff User (id=2) and Student User (id=3) get checkboxes.
    // Header checkbox = 1. Row checkboxes = 2. Total select-related = 3.
    const selectCheckboxes = screen.getAllByRole('checkbox', { name: /select/i });
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

    const checkboxesInOwnRow = Array.from(ownRow!.querySelectorAll('input[type="checkbox"]'));
    const selectCheckboxInOwnRow = checkboxesInOwnRow.find(
      (el) => el.getAttribute('aria-label')?.toLowerCase().includes('select'),
    );
    expect(selectCheckboxInOwnRow).toBeUndefined();
  });

  it('clicking a row checkbox shows bulk toolbar', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /select student user/i });
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
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });
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
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /bulk delete/i }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith('Delete 2 user(s)?');
    });

    await waitFor(() => {
      const deleteCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[1] === 'object' && c[1]?.method === 'DELETE',
      );
      expect(deleteCalls.length).toBe(2);
    });
  });

  // ---- Row action menu ----

  it('each row has a three-dot menu button', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    expect(menuButtons.length).toBe(3);
  });

  it('clicking three-dot button opens menu with Edit, Delete, Impersonate', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Sorted by Joined desc: Student User (0), Staff User (1), Admin User (2)
    fireEvent.click(menuButtons[0]);

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

  it('three-dot Edit navigates to /users/:id', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // Sorted by Joined desc: Student User (0), Staff User (1), Admin User (2)
    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(mockNavigate).toHaveBeenCalledWith('/users/3');
  });

  it('three-dot Delete calls DELETE endpoint', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (url === '/api/admin/users' && (!opts || opts.method !== 'DELETE')) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // Sorted by Joined desc: Student User (0), Staff User (1), Admin User (2)
    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('Student User'));
    });

    await waitFor(() => {
      // Row delete uses /api/users/:id (not the admin bulk endpoint)
      const deleteCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/users/3') && c[1]?.method === 'DELETE',
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
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    // Sorted by Joined desc: Student User (0), Staff User (1), Admin User (2)
    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

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
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    });
  });

  // ---- Make admin / Remove admin ----

  it('Make admin menu item appears on STAFF rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const staffRow = rows.find((r) => r.textContent?.includes('Staff User'));
    expect(staffRow).toBeDefined();

    const menuButton = staffRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument();
    });
  });

  it('Remove admin menu item appears on ADMIN rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    // We need a second admin row (the own row has "Remove admin" but it is disabled).
    // Add a second admin to the data set so we can test a non-own admin row.
    const usersWithTwoAdmins = [
      ...SAMPLE_USERS,
      {
        id: 10,
        email: 'admin2@example.com',
        displayName: 'Admin Two',
        role: 'ADMIN',
        provider: null,
        providers: [],
        cohort: null,
        externalAccountTypes: [],
        createdAt: '2025-04-01T00:00:00Z',
      },
    ];
    vi.stubGlobal('fetch', makeFetch(usersWithTwoAdmins));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AdminUsersPanel />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Admin Two')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const adminTwoRow = rows.find((r) => r.textContent?.includes('Admin Two'));
    expect(adminTwoRow).toBeDefined();

    const menuButton = adminTwoRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Remove admin' })).toBeInTheDocument();
    });
  });

  it('Make/Remove admin menu item does NOT appear on student rows', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const studentRow = rows.find((r) => r.textContent?.includes('Student User'));
    expect(studentRow).toBeDefined();

    const menuButton = studentRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    });

    expect(screen.queryByRole('menuitem', { name: /make admin|remove admin/i })).not.toBeInTheDocument();
  });

  it('self-demotion Remove admin button is disabled on own admin row', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const ownRow = rows.find((r) => r.textContent?.includes('Admin User'));
    expect(ownRow).toBeDefined();

    const menuButton = ownRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      // Own-row admin should see "Remove admin" but it is disabled
      const removeAdminItem = screen.getByRole('menuitem', { name: 'Remove admin' });
      expect(removeAdminItem).toBeDisabled();
    });
  });

  it('last-admin Remove admin button is disabled', async () => {
    // Only one admin in SAMPLE_USERS (id=1, the current user), but let's add a
    // separate non-self admin with only 1 admin total to test the guard.
    const singleAdminUsers = [
      {
        id: 99,
        email: 'sole-admin@example.com',
        displayName: 'Sole Admin',
        role: 'ADMIN',
        provider: null,
        providers: [],
        cohort: null,
        externalAccountTypes: [],
        createdAt: '2025-01-01T00:00:00Z',
      },
    ];
    // Log in as a different admin so we can interact with the sole-admin row
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
    vi.stubGlobal('fetch', makeFetch(singleAdminUsers));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AdminUsersPanel />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Sole Admin')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const soleAdminRow = rows.find((r) => r.textContent?.includes('Sole Admin'));
    expect(soleAdminRow).toBeDefined();

    const menuButton = soleAdminRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      const removeAdminItem = screen.getByRole('menuitem', { name: 'Remove admin' });
      expect(removeAdminItem).toBeDisabled();
    });
  });

  it('Make admin calls PUT /api/admin/users/:id with role=admin', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/cohorts') {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
      }
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    const staffRow = rows.find((r) => r.textContent?.includes('Staff User'));
    const menuButton = staffRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Make admin' }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c) => c[0] === '/api/admin/users/2' && c[1]?.method === 'PUT',
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1].body as string);
      expect(body.role).toBe('admin');
    });
  });
});
