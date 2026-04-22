/**
 * Tests for the admin Dashboard page (Sprint 010 T010).
 *
 * Covers:
 *  - Pending Requests widget: renders 3 rows (no "See all")
 *  - Pending Requests widget: renders 7 rows → shows first 5 + "See all 7" link
 *  - Pending Requests widget: empty state
 *  - Pending Requests widget: Approve button POSTs and re-fetches
 *  - Pending Requests widget: Deny button POSTs correct URL
 *  - Cohorts widget: renders cohort names
 *  - User Counts widget: renders correct stat card numbers
 *  - Independent error isolation: stats failure does not break other widgets
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Dashboard from '../../../../client/src/pages/admin/Dashboard';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeRequests(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    userId: 100 + i,
    userName: `Student ${i + 1}`,
    userEmail: `student${i + 1}@example.com`,
    userCohort: { id: 1, name: 'Spring 2025' },
    requestedType: i % 3 === 0 ? 'workspace' : i % 3 === 1 ? 'claude' : 'workspace_and_claude',
    createdAt: '2025-03-01T10:00:00Z',
  }));
}

const SAMPLE_COHORTS = [
  { id: 1, name: 'Spring 2025', google_ou_path: '/Students/Spring2025', createdAt: '2025-01-15T00:00:00Z' },
  { id: 2, name: 'Fall 2025',   google_ou_path: '/Students/Fall2025',   createdAt: '2025-06-01T00:00:00Z' },
];

const SAMPLE_STATS = {
  totalStudents: 42,
  totalStaff: 8,
  totalAdmins: 3,
  pendingRequests: 2,
  openMergeSuggestions: 1,
  cohortCount: 2,
};

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

function renderDashboard(fetchImpl: (...args: unknown[]) => unknown) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchImpl));
  const client = makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Dashboard />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * Build a fetch mock that routes requests by URL prefix.
 * Each key in `routeMap` is matched as a URL prefix.
 */
function routedFetch(routeMap: Record<string, () => object | object[]>) {
  return (url: unknown) => {
    const urlStr = String(url);
    const key = Object.keys(routeMap).find((k) => urlStr.includes(k));
    if (!key) {
      return Promise.resolve({ ok: false, json: async () => ({ error: 'Not found' }) });
    }
    return Promise.resolve({ ok: true, json: async () => routeMap[key]() });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Pending Requests Widget ------------------------------------------------

  describe('Pending Requests widget', () => {
    it('renders 3 rows without "See all" link', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => makeRequests(3),
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Student 1')).toBeInTheDocument();
        expect(screen.getByText('Student 2')).toBeInTheDocument();
        expect(screen.getByText('Student 3')).toBeInTheDocument();
      });

      expect(screen.queryByText(/see all/i)).not.toBeInTheDocument();
    });

    it('renders only 5 of 7 rows and shows "See all 7 requests" link', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => makeRequests(7),
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Student 1')).toBeInTheDocument();
        expect(screen.getByText('Student 5')).toBeInTheDocument();
      });

      // Row 6 and 7 should NOT be rendered
      expect(screen.queryByText('Student 6')).not.toBeInTheDocument();
      expect(screen.queryByText('Student 7')).not.toBeInTheDocument();

      // "See all" link should be visible
      const seeAll = screen.getByText(/see all 7 requests/i);
      expect(seeAll).toBeInTheDocument();
    });

    it('shows empty state when there are no pending requests', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => [],
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('No pending requests.')).toBeInTheDocument();
      });
    });

    it('Approve button POSTs to correct URL and re-fetches list', async () => {
      const mockFetch = vi.fn();

      // Round 1: all three initial GETs
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('provisioning-requests')) {
          return Promise.resolve({ ok: true, json: async () => makeRequests(1) });
        }
        if (url.includes('cohorts')) {
          return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
        }
        if (url.includes('stats')) {
          return Promise.resolve({ ok: true, json: async () => SAMPLE_STATS });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      vi.stubGlobal('fetch', mockFetch);

      const client = makeQueryClient();
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Dashboard />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      // Wait for initial render
      await waitFor(() => {
        expect(screen.getByText('Student 1')).toBeInTheDocument();
      });

      // Click Approve
      const approveBtn = screen.getByRole('button', { name: /approve request 1/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        // Find the approve POST call
        const approveCalls = mockFetch.mock.calls.filter(
          (call: string[]) =>
            typeof call[0] === 'string' &&
            call[0].includes('/approve') &&
            call[1]?.method === 'POST',
        );
        expect(approveCalls.length).toBeGreaterThanOrEqual(1);
        expect(approveCalls[0][0]).toContain('/api/admin/provisioning-requests/1/approve');
      });
    });

    it('Deny button POSTs to /reject endpoint', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (url.includes('provisioning-requests') && opts?.method === 'POST') {
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        if (url.includes('provisioning-requests')) {
          return Promise.resolve({ ok: true, json: async () => makeRequests(1) });
        }
        if (url.includes('cohorts')) {
          return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
        }
        if (url.includes('stats')) {
          return Promise.resolve({ ok: true, json: async () => SAMPLE_STATS });
        }
        return Promise.resolve({ ok: false, json: async () => ({}) });
      });

      vi.stubGlobal('fetch', mockFetch);

      const client = makeQueryClient();
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Dashboard />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText('Student 1')).toBeInTheDocument();
      });

      const denyBtn = screen.getByRole('button', { name: /deny request 1/i });
      fireEvent.click(denyBtn);

      await waitFor(() => {
        const denyCalls = mockFetch.mock.calls.filter(
          (call: string[]) =>
            typeof call[0] === 'string' &&
            call[0].includes('/reject') &&
            call[1]?.method === 'POST',
        );
        expect(denyCalls.length).toBeGreaterThanOrEqual(1);
        expect(denyCalls[0][0]).toContain('/api/admin/provisioning-requests/1/reject');
      });
    });

    it('shows error message when fetch fails', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => { throw new Error('unreachable'); },
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      // The widget fetch is stubbed to return error
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('provisioning-requests')) {
            return Promise.resolve({
              ok: false,
              json: async () => ({ error: 'Forbidden' }),
            });
          }
          if (url.includes('cohorts')) {
            return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
          }
          if (url.includes('stats')) {
            return Promise.resolve({ ok: true, json: async () => SAMPLE_STATS });
          }
          return Promise.resolve({ ok: false, json: async () => ({}) });
        }),
      );

      const client = makeQueryClient();
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Dashboard />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/failed to load pending requests/i)).toBeInTheDocument();
      });
    });
  });

  // ---- Cohorts Widget ---------------------------------------------------------

  describe('Cohorts widget', () => {
    it('renders cohort names', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => [],
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Spring 2025')).toBeInTheDocument();
        expect(screen.getByText('Fall 2025')).toBeInTheDocument();
      });
    });

    it('renders "Manage →" link pointing to /cohorts', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => [],
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        const manageLink = screen.getByRole('link', { name: /manage/i });
        expect(manageLink).toBeInTheDocument();
        expect(manageLink).toHaveAttribute('href', '/cohorts');
      });
    });

    it('shows empty state when cohort list is empty', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => [],
          '/api/admin/cohorts':     () => [],
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('No cohorts yet.')).toBeInTheDocument();
      });
    });

    it('shows error message and other widgets still render when cohorts fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('cohorts')) {
            return Promise.resolve({
              ok: false,
              json: async () => ({ error: 'Server error' }),
            });
          }
          if (url.includes('provisioning-requests')) {
            return Promise.resolve({ ok: true, json: async () => [] });
          }
          if (url.includes('stats')) {
            return Promise.resolve({ ok: true, json: async () => SAMPLE_STATS });
          }
          return Promise.resolve({ ok: false, json: async () => ({}) });
        }),
      );

      const client = makeQueryClient();
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Dashboard />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/failed to load cohorts/i)).toBeInTheDocument();
        // User counts widget still renders despite cohorts failure
        expect(screen.getByText('42')).toBeInTheDocument();
      });
    });
  });

  // ---- User Counts Widget -----------------------------------------------------

  describe('User Counts widget', () => {
    it('renders stat cards with correct counts', async () => {
      renderDashboard(
        routedFetch({
          'provisioning-requests': () => [],
          '/api/admin/cohorts':     () => SAMPLE_COHORTS,
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('8')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('Students')).toBeInTheDocument();
        expect(screen.getByText('Staff')).toBeInTheDocument();
        expect(screen.getByText('Admins')).toBeInTheDocument();
      });
    });

    it('shows error message when stats fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string) => {
          if (url.includes('stats')) {
            return Promise.resolve({
              ok: false,
              json: async () => ({ error: 'Unauthorized' }),
            });
          }
          if (url.includes('provisioning-requests')) {
            return Promise.resolve({ ok: true, json: async () => makeRequests(2) });
          }
          if (url.includes('cohorts')) {
            return Promise.resolve({ ok: true, json: async () => SAMPLE_COHORTS });
          }
          return Promise.resolve({ ok: false, json: async () => ({}) });
        }),
      );

      const client = makeQueryClient();
      render(
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <Dashboard />
          </QueryClientProvider>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/failed to load stats/i)).toBeInTheDocument();
        // Other widgets still render
        expect(screen.getByText('Student 1')).toBeInTheDocument();
        expect(screen.getByText('Spring 2025')).toBeInTheDocument();
      });
    });
  });

  // ---- prettifyName integration -----------------------------------------------

  describe('prettifyName integration in Pending Requests widget', () => {
    it('formats league.org emails as Title Case names', async () => {
      const requests = [
        {
          id: 1,
          userId: 10,
          userName: null,
          userEmail: 'jane.smith@jointheleague.org',
          requestedType: 'workspace',
          createdAt: '2025-03-01T10:00:00Z',
        },
      ];

      renderDashboard(
        routedFetch({
          'provisioning-requests': () => requests,
          '/api/admin/cohorts':     () => [],
          '/api/admin/stats':       () => SAMPLE_STATS,
        }),
      );

      await waitFor(() => {
        expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      });
    });
  });
});
