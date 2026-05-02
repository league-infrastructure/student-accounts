/**
 * Tests for LlmProxyUsersPanel (Sprint 024, ticket 005).
 *
 * Covers:
 *  - Renders the table with data from the API.
 *  - Search bar filters rows by name and email (case-insensitive).
 *  - Sortable column headers sort rows; clicking same header toggles direction.
 *  - Checkbox selection and bulk-revoke continue to work on filtered+sorted rows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LlmProxyUsersPanel from '../../client/src/pages/admin/LlmProxyUsersPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ROWS = [
  {
    userId: 1,
    displayName: 'Alice Zhang',
    email: 'alice@example.com',
    role: 'USER',
    cohort: { id: 10, name: 'Alpha' },
    tokenId: 101,
    tokensUsed: 5000,
    tokenLimit: 50000,
    requestCount: 20,
    expiresAt: '2026-07-01T00:00:00Z',
    grantedAt: '2026-01-01T00:00:00Z',
  },
  {
    userId: 2,
    displayName: 'Bob Smith',
    email: 'bob@example.com',
    role: 'USER',
    cohort: { id: 11, name: 'Beta' },
    tokenId: 102,
    tokensUsed: 20000,
    tokenLimit: 50000,
    requestCount: 80,
    expiresAt: '2026-05-01T00:00:00Z',
    grantedAt: '2026-01-01T00:00:00Z',
  },
  {
    userId: 3,
    displayName: null,
    email: 'charlie@example.com',
    role: 'USER',
    cohort: null,
    tokenId: 103,
    tokensUsed: 1000,
    tokenLimit: 50000,
    requestCount: 5,
    expiresAt: '2026-09-01T00:00:00Z',
    grantedAt: '2026-01-01T00:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(rows: object[] = ROWS) {
  return vi.fn(async (url: string) => {
    if (url === '/api/admin/users/with-llm-proxy') {
      return { ok: true, status: 200, json: async () => rows };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LlmProxyUsersPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('LlmProxyUsersPanel — basic render', () => {
  it('renders all rows returned by the API', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    // Row 3 has null displayName so falls back to email; email appears in both Name
    // and Email cells, so use getAllByText and assert at least one instance exists.
    expect(screen.getAllByText('charlie@example.com').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the search input', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: /search users/i })).toBeInTheDocument();
    });
  });

  it('renders sortable column headers', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/^Name/)).toBeInTheDocument();
    });
    expect(screen.getByText(/^Email/)).toBeInTheDocument();
    expect(screen.getByText(/^Cohort/)).toBeInTheDocument();
    expect(screen.getByText(/^Usage/)).toBeInTheDocument();
    expect(screen.getByText(/^Expires/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Search filtering
// ---------------------------------------------------------------------------

describe('LlmProxyUsersPanel — search filtering', () => {
  it('filters rows by display name (case-insensitive)', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const searchBox = screen.getByRole('searchbox', { name: /search users/i });
    fireEvent.change(searchBox, { target: { value: 'alice' } });

    expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument();
    expect(screen.queryByText('charlie@example.com')).not.toBeInTheDocument();
  });

  it('filters rows by email (case-insensitive)', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    });

    const searchBox = screen.getByRole('searchbox', { name: /search users/i });
    fireEvent.change(searchBox, { target: { value: 'BOB@EXAMPLE' } });

    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.queryByText('Alice Zhang')).not.toBeInTheDocument();
  });

  it('shows no rows when search matches nothing', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const searchBox = screen.getByRole('searchbox', { name: /search users/i });
    fireEvent.change(searchBox, { target: { value: 'xyznotfound' } });

    expect(screen.queryByText('Alice Zhang')).not.toBeInTheDocument();
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument();
    expect(screen.getByText(/no users have an active llm proxy token/i)).toBeInTheDocument();
  });

  it('restores all rows when search is cleared', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const searchBox = screen.getByRole('searchbox', { name: /search users/i });
    fireEvent.change(searchBox, { target: { value: 'alice' } });
    expect(screen.queryByText('Bob Smith')).not.toBeInTheDocument();

    fireEvent.change(searchBox, { target: { value: '' } });
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('LlmProxyUsersPanel — sortable column headers', () => {
  it('sorts by Name ascending by default (first data row is Alice)', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const rows = screen.getAllByRole('row');
    // rows[0] = header, rows[1] = first data row
    expect(rows[1]).toHaveTextContent('Alice Zhang');
  });

  it('clicking Name header a second time reverses sort order', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const nameHeader = screen.getByText(/^Name/);
    // First click: should already be asc, so clicking once reverses to desc
    fireEvent.click(nameHeader);

    const rows = screen.getAllByRole('row');
    // desc order: Charlie (null displayName → email "charlie@...") should come before Bob?
    // Actually: Alice < Bob < Charlie alphabetically, so desc → Charlie first
    // "charlie@example.com" > "Bob Smith" > "Alice Zhang" (localeCompare on display name or email fallback)
    expect(rows[1]).toHaveTextContent('charlie@example.com');
  });

  it('clicking Email header sorts by email ascending', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const emailHeader = screen.getByText(/^Email/);
    fireEvent.click(emailHeader);

    const rows = screen.getAllByRole('row');
    // alice < bob < charlie
    expect(rows[1]).toHaveTextContent('alice@example.com');
    expect(rows[2]).toHaveTextContent('bob@example.com');
  });

  it('clicking Usage header sorts by tokensUsed ascending (Charlie first with 1000)', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const usageHeader = screen.getByText(/^Usage/);
    fireEvent.click(usageHeader);

    const rows = screen.getAllByRole('row');
    // tokensUsed: Charlie=1000, Alice=5000, Bob=20000
    expect(rows[1]).toHaveTextContent('charlie@example.com');
    expect(rows[2]).toHaveTextContent('Alice Zhang');
    expect(rows[3]).toHaveTextContent('Bob Smith');
  });

  it('clicking Expires header sorts by expiry date ascending (Bob first: May 2026)', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const expiresHeader = screen.getByText(/^Expires/);
    fireEvent.click(expiresHeader);

    const rows = screen.getAllByRole('row');
    // expiresAt: Bob=May 2026, Alice=July 2026, Charlie=Sep 2026
    expect(rows[1]).toHaveTextContent('Bob Smith');
  });

  it('clicking Cohort header sorts by cohort name ascending', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    const cohortHeader = screen.getByText(/^Cohort/);
    fireEvent.click(cohortHeader);

    const rows = screen.getAllByRole('row');
    // cohort names: ''(Charlie/null) < 'Alpha'(Alice) < 'Beta'(Bob)
    expect(rows[1]).toHaveTextContent('charlie@example.com');
    expect(rows[2]).toHaveTextContent('Alice Zhang');
    expect(rows[3]).toHaveTextContent('Bob Smith');
  });

  it('clicking a new column resets sort direction to ascending', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    // Click Name twice → desc
    const nameHeader = screen.getByText(/^Name/);
    fireEvent.click(nameHeader); // now desc

    // Now click Email → should be asc for email
    const emailHeader = screen.getByText(/^Email/);
    fireEvent.click(emailHeader);

    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// Checkbox selection + bulk revoke on filtered rows
// ---------------------------------------------------------------------------

describe('LlmProxyUsersPanel — selection on filtered rows', () => {
  it('select-all only selects visible (filtered) rows', async () => {
    (globalThis as any).fetch = makeFetch();
    // Also stub bulk-revoke to succeed
    const bulkRevokeFetch = vi.fn(async (url: string, opts?: RequestInit) => {
      if (url === '/api/admin/users/with-llm-proxy') {
        return { ok: true, status: 200, json: async () => ROWS };
      }
      if (url === '/api/admin/users/bulk-revoke-llm-proxy') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ succeeded: [2], failed: [], skipped: [] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as any).fetch = bulkRevokeFetch;

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Zhang')).toBeInTheDocument();
    });

    // Filter to just Bob
    const searchBox = screen.getByRole('searchbox', { name: /search users/i });
    fireEvent.change(searchBox, { target: { value: 'bob' } });

    await waitFor(() => {
      expect(screen.queryByText('Alice Zhang')).not.toBeInTheDocument();
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    });

    // Select all (which is just Bob)
    const selectAll = screen.getByRole('checkbox', { name: /select all/i });
    fireEvent.click(selectAll);

    // The revoke button should show count=1 (only Bob selected)
    expect(screen.getByRole('button', { name: /revoke tokens \(1\)/i })).toBeInTheDocument();

    // Alice's checkbox should not be checked — she's not visible
    // but we verify the count via the button label
  });
});
