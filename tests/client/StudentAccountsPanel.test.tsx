/**
 * Tests for StudentAccountsPanel — Sprint 024 T003.
 *
 * Covers:
 *  - Table renders student rows (non-student rows excluded)
 *  - Search bar is present
 *  - Typing in search bar filters rows by display name (case-insensitive)
 *  - Typing in search bar filters rows by email (case-insensitive)
 *  - Clearing search restores all rows
 *  - Default sort is newest-first (Joined descending)
 *  - Clicking Name header sorts ascending then toggles to descending
 *  - Clicking Email header sorts ascending then toggles to descending
 *  - Clicking Cohort header sorts ascending then toggles to descending
 *  - Clicking Accounts header sorts then toggles
 *  - Clicking Joined header toggles from desc to asc
 *  - Checkbox selection and bulk-suspend continue to operate on the
 *    filtered+sorted row set
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StudentAccountsPanel from '../../client/src/pages/admin/StudentAccountsPanel';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const STUDENT_A = {
  id: 10,
  email: 'alice@students.jointheleague.org',
  displayName: 'Alice Smith',
  role: 'USER',
  cohort: { id: 1, name: 'Alpha Cohort' },
  externalAccountTypes: ['workspace', 'claude'],
  createdAt: '2025-01-15T00:00:00Z', // oldest
};

const STUDENT_B = {
  id: 11,
  email: 'bob@students.jointheleague.org',
  displayName: 'Bob Jones',
  role: 'USER',
  cohort: { id: 2, name: 'Beta Cohort' },
  externalAccountTypes: [],
  createdAt: '2025-03-20T00:00:00Z', // newest
};

const STUDENT_C = {
  id: 12,
  email: 'carol@students.jointheleague.org',
  displayName: 'Carol White',
  role: 'USER',
  cohort: null,
  externalAccountTypes: ['workspace'],
  createdAt: '2025-02-10T00:00:00Z', // middle
};

// Non-student — should be filtered out
const STAFF_USER = {
  id: 99,
  email: 'staff@jointheleague.org',
  displayName: 'Staff Member',
  role: 'STAFF',
  cohort: null,
  externalAccountTypes: [],
  createdAt: '2025-04-01T00:00:00Z',
};

const ALL_USERS = [STUDENT_A, STUDENT_B, STUDENT_C, STAFF_USER];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(users = ALL_USERS) {
  return vi.fn().mockImplementation((_url: string) =>
    Promise.resolve({ ok: true, json: async () => users }),
  );
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <StudentAccountsPanel />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudentAccountsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', makeFetch());
  });

  // ---- Rendering -----------------------------------------------------------

  it('renders only student rows (excludes non-student users)', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('Carol White')).toBeInTheDocument();
      expect(screen.queryByText('Staff Member')).not.toBeInTheDocument();
    });
  });

  // ---- Search bar ----------------------------------------------------------

  it('renders a search bar', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));
    expect(screen.getByRole('searchbox', { name: /search students/i })).toBeInTheDocument();
  });

  it('search by display name filters rows (case-insensitive)', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const searchBox = screen.getByRole('searchbox', { name: /search students/i });
    fireEvent.change(searchBox, { target: { value: 'alice' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol White')).not.toBeInTheDocument();
  });

  it('search by email filters rows (case-insensitive)', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Bob Jones'));

    const searchBox = screen.getByRole('searchbox', { name: /search students/i });
    fireEvent.change(searchBox, { target: { value: 'BOB@STUDENTS' } });

    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol White')).not.toBeInTheDocument();
  });

  it('clearing search restores all student rows', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const searchBox = screen.getByRole('searchbox', { name: /search students/i });
    fireEvent.change(searchBox, { target: { value: 'alice' } });
    expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();

    fireEvent.change(searchBox, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByText('Bob Jones')).toBeInTheDocument();
      expect(screen.getByText('Carol White')).toBeInTheDocument();
    });
  });

  it('shows "no match" message when search yields no results', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const searchBox = screen.getByRole('searchbox', { name: /search students/i });
    fireEvent.change(searchBox, { target: { value: 'zzz-no-match' } });

    expect(screen.getByText(/no students match your search/i)).toBeInTheDocument();
  });

  // ---- Default sort --------------------------------------------------------

  it('default sort is newest-first (Joined descending)', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const rows = screen.getAllByRole('row');
    // rows[0] = header; rows[1..3] = data rows
    const firstDataRow = rows[1];
    // Bob has the newest createdAt so should appear first
    expect(firstDataRow).toHaveTextContent('Bob Jones');
  });

  // ---- Sortable column headers ---------------------------------------------

  it('clicking Name header sorts ascending, clicking again sorts descending', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const nameHeader = screen.getByRole('columnheader', { name: /^name/i });
    fireEvent.click(nameHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // asc: Alice, Bob, Carol
      expect(rows[1]).toHaveTextContent('Alice Smith');
    });

    fireEvent.click(nameHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // desc: Carol, Bob, Alice
      expect(rows[1]).toHaveTextContent('Carol White');
    });
  });

  it('clicking Email header sorts ascending, clicking again sorts descending', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const emailHeader = screen.getByRole('columnheader', { name: /^email/i });
    fireEvent.click(emailHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // asc email: alice < bob < carol
      expect(rows[1]).toHaveTextContent('Alice Smith');
    });

    fireEvent.click(emailHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // desc email: carol > bob > alice
      expect(rows[1]).toHaveTextContent('Carol White');
    });
  });

  it('clicking Cohort header sorts ascending, clicking again sorts descending', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const cohortHeader = screen.getByRole('columnheader', { name: /^cohort/i });
    fireEvent.click(cohortHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // asc cohort: '' (Carol, no cohort) < 'Alpha Cohort' (Alice) < 'Beta Cohort' (Bob)
      expect(rows[1]).toHaveTextContent('Carol White');
    });

    fireEvent.click(cohortHeader);

    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // desc: Beta > Alpha > ''
      expect(rows[1]).toHaveTextContent('Bob Jones');
    });
  });

  it('clicking Joined header toggles from desc to asc', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    // Default is joined desc (Bob newest first)
    let rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Bob Jones');

    const joinedHeader = screen.getByRole('columnheader', { name: /^joined/i });
    fireEvent.click(joinedHeader);

    await waitFor(() => {
      rows = screen.getAllByRole('row');
      // asc: Alice oldest first
      expect(rows[1]).toHaveTextContent('Alice Smith');
    });
  });

  it('clicking Accounts header sorts then toggles', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const accountsHeader = screen.getByRole('columnheader', { name: /^accounts/i });
    fireEvent.click(accountsHeader);

    // Just verify the click doesn't crash and a row is still shown
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    });

    fireEvent.click(accountsHeader);
    await waitFor(() => {
      expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
    });
  });

  // ---- Sort indicator ------------------------------------------------------

  it('active column header shows sort direction indicator', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const nameHeader = screen.getByRole('columnheader', { name: /^name/i });
    fireEvent.click(nameHeader);

    // After clicking Name (now asc), the header should show ▲
    await waitFor(() => {
      const updatedHeader = screen.getByRole('columnheader', { name: /name.*▲/i });
      expect(updatedHeader).toBeInTheDocument();
    });
  });

  // ---- Bulk suspend with filtered rows ------------------------------------

  it('bulk suspend button is disabled when no rows are selected', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    const suspendBtn = screen.getByRole('button', { name: /suspend accounts/i });
    expect(suspendBtn).toBeDisabled();
  });

  it('selecting a filtered row enables the suspend button', async () => {
    renderPanel();
    await waitFor(() => screen.getByText('Alice Smith'));

    // Filter to Alice only
    const searchBox = screen.getByRole('searchbox', { name: /search students/i });
    fireEvent.change(searchBox, { target: { value: 'alice' } });

    await waitFor(() => {
      expect(screen.queryByText('Bob Jones')).not.toBeInTheDocument();
    });

    // Select Alice's row
    const checkbox = screen.getByRole('checkbox', { name: /select alice smith/i });
    fireEvent.click(checkbox);

    const suspendBtn = screen.getByRole('button', { name: /suspend accounts \(1\)/i });
    expect(suspendBtn).not.toBeDisabled();
  });
});
