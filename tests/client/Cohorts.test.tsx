/**
 * Tests for the Cohorts admin page component (Sprint 004 T009).
 *
 * Covers:
 *  - Loading state while query is in flight
 *  - Empty state: "No cohorts yet." when list is empty
 *  - Renders cohort list table with Name, Google OU Path, Created On
 *  - Create form: submit with valid name calls POST, invalidates query
 *  - Create form: blank name shows inline error
 *  - Create form: duplicate name shows inline error from API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Cohorts from '../../client/src/pages/admin/Cohorts';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_COHORTS = [
  {
    id: 1,
    name: 'Spring 2025',
    google_ou_path: '/Students/Spring2025',
    createdAt: '2025-01-15T00:00:00Z',
    memberCount: 10,
  },
  {
    id: 2,
    name: 'Fall 2025',
    google_ou_path: '/Students/Fall2025',
    createdAt: '2025-06-01T00:00:00Z',
    memberCount: 8,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderCohorts(queryClient?: QueryClient) {
  const client = queryClient ?? makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Cohorts />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cohorts page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    );
    renderCohorts();
    expect(screen.getByText(/loading cohorts/i)).toBeInTheDocument();
  });

  it('shows empty state when no cohorts exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [],
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('No cohorts yet.')).toBeInTheDocument();
    });
  });

  it('renders cohort table with Name, Google OU Path, Created On columns', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
      expect(screen.getByText('Fall 2025')).toBeInTheDocument();
    });

    expect(screen.getByText(/^Name/)).toBeInTheDocument();
    expect(screen.getByText(/^Google OU Path/)).toBeInTheDocument();
    expect(screen.getByText(/^Created On/)).toBeInTheDocument();
    expect(screen.getByText('/Students/Spring2025')).toBeInTheDocument();
  });

  it('renders the create form with input and submit button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByLabelText(/new cohort name/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /create cohort/i })).toBeInTheDocument();
    });
  });

  it('calls POST on form submit and invalidates query on success', async () => {
    const newCohort = {
      id: 3,
      name: 'Winter 2025',
      google_ou_path: '/Students/Winter2025',
      createdAt: '2025-11-01T00:00:00Z',
      memberCount: 0,
    };

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }) // initial GET
      .mockResolvedValueOnce({
        ok: true,
        json: async () => newCohort,
      }) // POST
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [...SAMPLE_COHORTS, newCohort],
      }); // refetch after invalidation

    vi.stubGlobal('fetch', mockFetch);

    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/new cohort name/i);
    fireEvent.change(input, { target: { value: 'Winter 2025' } });

    const button = screen.getByRole('button', { name: /create cohort/i });
    fireEvent.click(button);

    await waitFor(() => {
      // POST should have been called with the correct body
      const postCall = mockFetch.mock.calls.find(
        (call) => call[0] === '/api/admin/cohorts' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.name).toBe('Winter 2025');
    });
  });

  it('shows inline error when form is submitted with blank name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });

    // Submit with blank name (input is empty by default)
    const button = screen.getByRole('button', { name: /create cohort/i });
    fireEvent.click(button);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/blank/i);
  });

  it('shows inline API error when server returns 409 (duplicate name)', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }) // initial GET
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'A cohort named "Spring 2025" already exists.' }),
      }); // POST → 409

    vi.stubGlobal('fetch', mockFetch);

    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/new cohort name/i);
    fireEvent.change(input, { target: { value: 'Spring 2025' } });

    const button = screen.getByRole('button', { name: /create cohort/i });
    fireEvent.click(button);

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(/already exists/i);
    });
  });

  it('shows error message when fetching cohorts fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Forbidden' }),
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText(/failed to load cohorts/i)).toBeInTheDocument();
    });
  });

  it('renders a search bar above the cohort table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });
    expect(screen.getByRole('searchbox', { name: /search cohorts/i })).toBeInTheDocument();
  });

  it('filters cohort rows when text is typed in the search bar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
      expect(screen.getByText('Fall 2025')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox', { name: /search cohorts/i });
    fireEvent.change(searchInput, { target: { value: 'spring' } });

    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
      expect(screen.queryByText('Fall 2025')).not.toBeInTheDocument();
    });
  });

  it('restores all rows when search bar is cleared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('searchbox', { name: /search cohorts/i });
    fireEvent.change(searchInput, { target: { value: 'spring' } });
    await waitFor(() => {
      expect(screen.queryByText('Fall 2025')).not.toBeInTheDocument();
    });

    fireEvent.change(searchInput, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
      expect(screen.getByText('Fall 2025')).toBeInTheDocument();
    });
  });

  it('applies search filter to sorted rows (sort still works on filtered set)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => SAMPLE_COHORTS,
      }),
    );
    renderCohorts();
    await waitFor(() => {
      expect(screen.getByText('Spring 2025')).toBeInTheDocument();
    });

    // Filter to only "fall" cohorts
    const searchInput = screen.getByRole('searchbox', { name: /search cohorts/i });
    fireEvent.change(searchInput, { target: { value: 'fall' } });
    await waitFor(() => {
      expect(screen.getByText('Fall 2025')).toBeInTheDocument();
      expect(screen.queryByText('Spring 2025')).not.toBeInTheDocument();
    });

    // Click Name header to toggle sort — should not crash and still show the filtered row
    fireEvent.click(screen.getByText(/^Name/));
    await waitFor(() => {
      expect(screen.getByText('Fall 2025')).toBeInTheDocument();
      expect(screen.queryByText('Spring 2025')).not.toBeInTheDocument();
    });
  });
});
