import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StaffDirectory from '../../client/src/pages/staff/StaffDirectory';

/* ------------------------------------------------------------------ */
/*  Sample data                                                          */
/* ------------------------------------------------------------------ */

const SAMPLE_STUDENTS = [
  {
    id: 1,
    displayName: null,
    email: 'alice.smith@jointheleague.org',
    cohort: { id: 10, name: 'Spring 2025' },
    externalAccountTypes: ['workspace', 'pike13'],
  },
  {
    id: 2,
    displayName: 'Bobby Jones',
    email: 'bobby@example.com',
    cohort: { id: 11, name: 'Fall 2025' },
    externalAccountTypes: ['claude'],
  },
  {
    id: 3,
    displayName: 'Carol White',
    email: 'carol@example.com',
    cohort: null,
    externalAccountTypes: [],
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffDirectory />
    </MemoryRouter>,
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('StaffDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_STUDENTS,
      }),
    );
  });

  it('shows loading state initially', () => {
    // fetch never resolves in this test
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    renderPage();
    expect(screen.getByText(/Loading directory/i)).toBeInTheDocument();
  });

  it('renders student table after data loads', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Student Directory')).toBeInTheDocument());
    // prettifyName converts alice.smith@jointheleague.org → "Alice Smith"
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('Bobby Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol White')).toBeInTheDocument();
  });

  it('shows error message when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({}) }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText(/Error loading directory/i)).toBeInTheDocument());
  });

  it('renders Name, Email, Cohort, Accounts column headers', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Student Directory'));
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Cohort')).toBeInTheDocument();
    expect(screen.getByText('Accounts')).toBeInTheDocument();
  });

  it('filters students by name search', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const searchBox = screen.getByRole('searchbox');
    fireEvent.change(searchBox, { target: { value: 'alice' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bobby Jones')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol White')).not.toBeInTheDocument();
  });

  it('filters students by email search', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Bobby Jones'));

    const searchBox = screen.getByRole('searchbox');
    fireEvent.change(searchBox, { target: { value: 'bobby@example' } });

    expect(screen.getByText('Bobby Jones')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
  });

  it('shows "No students match" when search yields no results', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const searchBox = screen.getByRole('searchbox');
    fireEvent.change(searchBox, { target: { value: 'zzznomatch' } });

    expect(screen.getByText(/No students match this filter/i)).toBeInTheDocument();
  });

  it('filters students by cohort', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const cohortSelect = screen.getByRole('combobox', { name: /filter by cohort/i });
    fireEvent.change(cohortSelect, { target: { value: '10' } });

    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.queryByText('Bobby Jones')).not.toBeInTheDocument();
  });

  it('filters students by account type', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const accountSelect = screen.getByRole('combobox', { name: /filter by account type/i });
    fireEvent.change(accountSelect, { target: { value: 'claude' } });

    expect(screen.getByText('Bobby Jones')).toBeInTheDocument();
    expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('Carol White')).not.toBeInTheDocument();
  });

  it('shows inline detail when a row is clicked', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const nameCell = screen.getByText('Alice Smith');
    fireEvent.click(nameCell.closest('tr')!);

    // detail panel should appear with heading and email
    await waitFor(() => {
      // detail heading (inside the detail panel h3)
      const headings = screen.getAllByText('Alice Smith');
      expect(headings.length).toBeGreaterThan(1);
    });

    // email appears in detail panel
    expect(screen.getAllByText('alice.smith@jointheleague.org').length).toBeGreaterThanOrEqual(1);
  });

  it('hides detail when the same row is clicked again', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    const row = screen.getByText('Alice Smith').closest('tr')!;
    fireEvent.click(row);

    await waitFor(() => {
      const headings = screen.getAllByText('Alice Smith');
      expect(headings.length).toBeGreaterThan(1);
    });

    // click again to deselect
    fireEvent.click(row);
    await waitFor(() => {
      expect(screen.getAllByText('Alice Smith').length).toBe(1);
    });
  });

  it('does not render any provisioning or action buttons', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    // no Provision, Delete, Edit, or Merge buttons
    expect(screen.queryByRole('button', { name: /provision/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('calls GET /api/staff/directory on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_STUDENTS,
    });
    vi.stubGlobal('fetch', mockFetch);

    renderPage();
    await waitFor(() => screen.getByText('Alice Smith'));

    expect(mockFetch).toHaveBeenCalledWith('/api/staff/directory');
  });
});
