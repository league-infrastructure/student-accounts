/**
 * Tests for AdminUsersPanel — /admin/users (Sprint 025 T005).
 *
 * Covers:
 *  - Renders all users (not filtered)
 *  - Name and email cells are links to /users/:id
 *  - Search bar filters by name or email (client-side, real-time)
 *  - Role lozenge bar: All / Staff / Admin / Student (radio)
 *  - Feature lozenge bar: Google / Pike 13 / GitHub / LLM Proxy / OAuth Client (multi-select)
 *  - Feature filter intersection semantics
 *  - Cohort column is removed
 *  - Column headers Name, Email, Accounts, Joined are sortable; Cohort is absent
 *  - Row action menu includes Edit, Delete, Impersonate
 *  - Make admin / Remove admin toggle appears only on STAFF/ADMIN rows
 *  - Self-demotion button is disabled
 *  - Last-admin demotion button is disabled
 *  - Bulk selection and bulk delete
 *  - Bulk "Suspend accounts" button: disabled when no student selected; opens confirm dialog
 *  - Bulk "Revoke LLM Proxy" button: disabled when no llmProxyEnabled selected; opens confirm
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
    providers: [{ provider: 'github', email: null }],
    externalAccountTypes: [],
    createdAt: '2025-01-01T00:00:00Z',
    llmProxyEnabled: false,
    oauthClientCount: 0,
  },
  {
    id: 2,
    email: 'staff@example.com',
    displayName: 'Staff User',
    role: 'STAFF',
    provider: null,
    providers: [{ provider: 'google', email: 'staff@gmail.com' }],
    externalAccountTypes: ['pike13'],
    createdAt: '2025-02-01T00:00:00Z',
    llmProxyEnabled: true,
    oauthClientCount: 0,
  },
  {
    id: 3,
    email: 'student@example.com',
    displayName: 'Student User',
    role: 'USER',
    provider: null,
    providers: [],
    externalAccountTypes: [],
    createdAt: '2025-03-01T00:00:00Z',
    llmProxyEnabled: false,
    oauthClientCount: 1,
  },
];

// ---- Helpers ----

function renderPanel(users = SAMPLE_USERS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal('fetch', makeFetch(users));
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminUsersPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function makeFetch(users = SAMPLE_USERS) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url === '/api/admin/users' && (!opts || !opts.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: async () => users });
    }
    // Default for mutations
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ---- Tests ----

describe('AdminUsersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('renders all users (not filtered)', async () => {
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
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());
    const allDots = screen.getAllByText('⋮');
    const thElement = allDots.find((el) => el.tagName === 'TH');
    expect(thElement).toBeTruthy();
  });

  it('does NOT render a Cohort column header', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());
    expect(screen.queryByText('Cohort')).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'student' } });

    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
    });
  });

  it('search box filters visible rows by email', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'staff@example' } });

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('shows "No users match this filter." when search matches nothing', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'xyzzy_no_match' } });

    await waitFor(() => {
      expect(screen.getByText('No users match this filter.')).toBeInTheDocument();
    });
  });

  // ---- Role lozenge bar ----

  it('renders role lozenge bar with All, Staff, Admin, Student pills', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const roleGroup = screen.getByRole('group', { name: 'Role filter' });
    expect(roleGroup).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Student' })).toBeInTheDocument();
  });

  it('role lozenge "All" is active by default', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const allBtn = screen.getByRole('button', { name: 'All' });
    expect(allBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking "Staff" role lozenge shows only staff users', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Staff' }));

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('clicking "Admin" role lozenge shows only admin users', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('clicking "Student" role lozenge shows only student users (no email-domain filter)', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Student' }));

    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
    });
  });

  it('switching role lozenge from Staff back to All restores all users', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Staff' }));
    await waitFor(() => expect(screen.queryByText('Admin User')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });
  });

  // ---- Feature lozenge bar ----

  it('renders feature lozenge bar with Google, Pike 13, GitHub, LLM Proxy, OAuth Client', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const featureGroup = screen.getByRole('group', { name: 'Feature filter' });
    expect(featureGroup).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pike 13' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LLM Proxy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OAuth Client' })).toBeInTheDocument();
  });

  it('all feature toggles are off by default', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const featureGroup = screen.getByRole('group', { name: 'Feature filter' });
    const buttons = featureGroup.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('feature "Google" toggle shows only users with a google provider', async () => {
    // Admin has github, Staff has google+pike13, Student has nothing
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('feature "GitHub" toggle shows only users with a github provider', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('feature "Pike 13" toggle shows only users with pike13 in externalAccountTypes', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Pike 13' }));

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('feature "LLM Proxy" toggle shows only users with llmProxyEnabled=true', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'LLM Proxy' }));

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('feature "OAuth Client" toggle shows only users with oauthClientCount > 0', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'OAuth Client' }));

    await waitFor(() => {
      expect(screen.getByText('Student User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
    });
  });

  it('feature toggles use intersection: Google + Pike 13 shows only users with both', async () => {
    // Staff has google + pike13, no one else has both
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pike 13' }));

    await waitFor(() => {
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
    });
  });

  it('feature intersection with no matches shows empty state', async () => {
    // GitHub + LLM Proxy: Admin has github but not llmProxy; nobody has both
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'LLM Proxy' }));

    await waitFor(() => {
      expect(screen.queryByText('Admin User')).not.toBeInTheDocument();
      expect(screen.queryByText('Staff User')).not.toBeInTheDocument();
      expect(screen.queryByText('Student User')).not.toBeInTheDocument();
      expect(screen.getByText('No users match this filter.')).toBeInTheDocument();
    });
  });

  it('deactivating a feature toggle re-expands results', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'LLM Proxy' }));
    await waitFor(() => expect(screen.queryByText('Admin User')).not.toBeInTheDocument());

    // Toggle off
    fireEvent.click(screen.getByRole('button', { name: 'LLM Proxy' }));
    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
      expect(screen.getByText('Staff User')).toBeInTheDocument();
      expect(screen.getByText('Student User')).toBeInTheDocument();
    });
  });

  // ---- Sortable headers ----

  it('renders all sortable column headers: Name, Email, Accounts, Joined (no Cohort)', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Email')).toBeInTheDocument();
      expect(screen.getByText('Accounts')).toBeInTheDocument();
      expect(screen.getByText('Joined')).toBeInTheDocument();
    });
    expect(screen.queryByText('Cohort')).not.toBeInTheDocument();
  });

  it('clicking the Name header sorts ascending', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const nameHeader = screen.getByText('Name');
    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(nameHeader.closest('th')?.textContent).toMatch(/▲/);
    });
  });

  it('sorts by Joined desc by default (most-recent-first)', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const rows = screen.getAllByRole('row').slice(1); // skip header
    const names = rows.map((r) => {
      const link = r.querySelector('a');
      return link?.textContent ?? '';
    });
    expect(names[0]).toBe('Student User');
    expect(names[1]).toBe('Staff User');
    expect(names[2]).toBe('Admin User');
  });

  // ---- Row checkboxes + bulk actions ----

  it('renders checkboxes for non-own rows and no checkbox for own row', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    // 3 users. Admin User (id=1) is the own row — no row checkbox.
    // Staff User (id=2) and Student User (id=3) get checkboxes.
    // Header checkbox = 1. Row checkboxes = 2. Total select-related = 3.
    const selectCheckboxes = screen.getAllByRole('checkbox', { name: /select/i });
    expect(selectCheckboxes.length).toBe(3);
  });

  it('clicking a row checkbox shows bulk toolbar', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

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
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);

    await waitFor(() => {
      expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    });
  });

  it('bulk Delete shows confirmation and calls DELETE for each selected user', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users' && (!opts || !opts.method)) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const headerCheckbox = screen.getByRole('checkbox', { name: /select all visible rows/i });
    fireEvent.click(headerCheckbox);
    await waitFor(() => expect(screen.getByText(/2 selected/i)).toBeInTheDocument());

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

  // ---- Bulk Suspend accounts ----

  it('"Suspend accounts" button is disabled when no student is selected', async () => {
    // Select only staff user (id=2) — not a student
    const usersWithNoStudent = [SAMPLE_USERS[0], SAMPLE_USERS[1]]; // admin + staff only
    renderPanel(usersWithNoStudent);
    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    const staffCheckbox = screen.getByRole('checkbox', { name: /select staff user/i });
    fireEvent.click(staffCheckbox);

    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    const suspendBtn = screen.getByRole('button', { name: /suspend accounts/i });
    expect(suspendBtn).toBeDisabled();
  });

  it('"Suspend accounts" button is enabled when at least one student is selected', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const studentCheckbox = screen.getByRole('checkbox', { name: /select student user/i });
    fireEvent.click(studentCheckbox);

    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    const suspendBtn = screen.getByRole('button', { name: /suspend accounts/i });
    expect(suspendBtn).not.toBeDisabled();
  });

  it('clicking "Suspend accounts" opens ConfirmDialog without calling mutation', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const studentCheckbox = screen.getByRole('checkbox', { name: /select student user/i });
    fireEvent.click(studentCheckbox);
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /suspend accounts/i }));

    // ConfirmDialog should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // bulk-suspend endpoint should NOT have been called yet
    const suspendCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url === '/api/admin/users/bulk-suspend-accounts',
    );
    expect(suspendCalls).toHaveLength(0);
  });

  it('cancelling the suspend dialog does not call the mutation', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select student user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /suspend accounts/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const suspendCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url === '/api/admin/users/bulk-suspend-accounts',
    );
    expect(suspendCalls).toHaveLength(0);
  });

  it('confirming the suspend dialog calls the bulk-suspend endpoint', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users' && (!opts || !opts.method)) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      if (url === '/api/admin/users/bulk-suspend-accounts') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ succeeded: [3], failed: [], totalEligible: 1 }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select student user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /suspend accounts/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Click the confirm button (label = "Suspend")
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));

    await waitFor(() => {
      const suspendCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => url === '/api/admin/users/bulk-suspend-accounts',
      );
      expect(suspendCalls).toHaveLength(1);
    });
  });

  // ---- Bulk Revoke LLM Proxy ----

  it('"Revoke LLM Proxy" button is disabled when no selected user has llmProxyEnabled', async () => {
    // Only select student (llmProxyEnabled=false) and admin (llmProxyEnabled=false)
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select student user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    const revokeBtn = screen.getByRole('button', { name: /revoke llm proxy/i });
    expect(revokeBtn).toBeDisabled();
  });

  it('"Revoke LLM Proxy" button is enabled when at least one selected user has llmProxyEnabled', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select staff user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    const revokeBtn = screen.getByRole('button', { name: /revoke llm proxy/i });
    expect(revokeBtn).not.toBeDisabled();
  });

  it('clicking "Revoke LLM Proxy" opens ConfirmDialog without calling mutation', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select staff user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /revoke llm proxy/i }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    const revokeCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url === '/api/admin/users/bulk-revoke-llm-proxy',
    );
    expect(revokeCalls).toHaveLength(0);
  });

  it('cancelling the revoke dialog does not call the mutation', async () => {
    const mockFetch = makeFetch();
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select staff user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /revoke llm proxy/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const revokeCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url === '/api/admin/users/bulk-revoke-llm-proxy',
    );
    expect(revokeCalls).toHaveLength(0);
  });

  it('confirming the revoke dialog calls the bulk-revoke endpoint', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users' && (!opts || !opts.method)) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      if (url === '/api/admin/users/bulk-revoke-llm-proxy') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ succeeded: [2], failed: [], skipped: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /select staff user/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /revoke llm proxy/i }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Click the confirm button (label = "Revoke")
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      const revokeCalls = mockFetch.mock.calls.filter(
        ([url]: [string]) => url === '/api/admin/users/bulk-revoke-llm-proxy',
      );
      expect(revokeCalls).toHaveLength(1);
    });
  });

  // ---- Row action menu ----

  it('each row has a three-dot menu button', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    expect(menuButtons.length).toBe(3);
  });

  it('clicking three-dot button opens menu with Edit, Delete, Impersonate', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Sorted by Joined desc: Student User (0), Staff User (1), Admin User (2)
    fireEvent.click(menuButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Impersonate' })).toBeInTheDocument();
    });
  });

  it('three-dot Edit navigates to /users/:id', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    // Sorted by Joined desc: Student User (0)
    fireEvent.click(menuButtons[0]);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(mockNavigate).toHaveBeenCalledWith('/users/3');
  });

  it('three-dot Delete calls DELETE endpoint', async () => {
    const mockConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('confirm', mockConfirm);

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users' && (!opts || !opts.method)) {
        return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.stringContaining('Student User'));
    });
    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('/api/users/3') && c[1]?.method === 'DELETE',
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it('three-dot menu closes on outside click', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const menuButtons = screen.getAllByRole('button', { name: /row actions/i });
    fireEvent.click(menuButtons[0]);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument(),
    );

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    });
  });

  // ---- Make admin / Remove admin ----

  it('Make admin menu item appears on STAFF rows', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const staffRow = rows.find((r) => r.textContent?.includes('Staff User'));
    expect(staffRow).toBeDefined();

    const menuButton = staffRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument();
    });
  });

  it('Make/Remove admin menu item does NOT appear on student rows', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Student User')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const studentRow = rows.find((r) => r.textContent?.includes('Student User'));
    expect(studentRow).toBeDefined();

    const menuButton = studentRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('menuitem', { name: /make admin|remove admin/i })).not.toBeInTheDocument();
  });

  it('self-demotion Remove admin button is disabled on own admin row', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Admin User')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const ownRow = rows.find((r) => r.textContent?.includes('Admin User'));
    expect(ownRow).toBeDefined();

    const menuButton = ownRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() => {
      const removeAdminItem = screen.getByRole('menuitem', { name: 'Remove admin' });
      expect(removeAdminItem).toBeDisabled();
    });
  });

  it('last-admin Remove admin button is disabled', async () => {
    const singleAdminUsers = [
      {
        id: 99,
        email: 'sole-admin@example.com',
        displayName: 'Sole Admin',
        role: 'ADMIN',
        provider: null,
        providers: [],
        externalAccountTypes: [],
        createdAt: '2025-01-01T00:00:00Z',
        llmProxyEnabled: false,
        oauthClientCount: 0,
      },
    ];
    mockUseAuth.mockReturnValue({
      user: { id: 1, email: 'admin@example.com', displayName: 'Admin User', role: 'ADMIN' },
      loading: false,
      logout: vi.fn(),
    });

    renderPanel(singleAdminUsers);

    await waitFor(() => expect(screen.getByText('Sole Admin')).toBeInTheDocument());

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
      if (opts?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => SAMPLE_USERS });
    });
    vi.stubGlobal('fetch', mockFetch);

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

    await waitFor(() => expect(screen.getByText('Staff User')).toBeInTheDocument());

    const rows = screen.getAllByRole('row');
    const staffRow = rows.find((r) => r.textContent?.includes('Staff User'));
    const menuButton = staffRow!.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    fireEvent.click(menuButton);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Make admin' })).toBeInTheDocument(),
    );
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
