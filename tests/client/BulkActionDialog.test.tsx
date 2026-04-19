/**
 * Tests for BulkActionDialog (Sprint 008 T003).
 *
 * Covers:
 *  - Dialog opens and fetches preview; shows count in message
 *  - Suspend dialog does NOT show the irreversibility warning
 *  - Remove dialog shows the irreversibility warning
 *  - Clicking Confirm fires the correct mutation endpoint
 *  - Result panel shows succeeded count after 200 response
 *  - Failure list appears after 207 response
 *  - Error message shown on 500 response
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkActionDialog } from '../../client/src/pages/admin/BulkActionDialog';
import type { BulkAction } from '../../client/src/pages/admin/BulkActionDialog';

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

function renderDialog(action: BulkAction, onClose = vi.fn(), queryClient?: QueryClient) {
  const client = queryClient ?? makeQueryClient();
  return {
    client,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <BulkActionDialog action={action} onClose={onClose} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

const SUSPEND_WORKSPACE_ACTION: BulkAction = {
  cohortId: 1,
  cohortName: 'Spring 2025',
  accountType: 'workspace',
  operation: 'suspend',
};

const REMOVE_WORKSPACE_ACTION: BulkAction = {
  cohortId: 1,
  cohortName: 'Spring 2025',
  accountType: 'workspace',
  operation: 'remove',
};

const SUSPEND_CLAUDE_ACTION: BulkAction = {
  cohortId: 2,
  cohortName: 'Fall 2025',
  accountType: 'claude',
  operation: 'suspend',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BulkActionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching preview', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
    );
    renderDialog(SUSPEND_WORKSPACE_ACTION);
    expect(screen.getByText(/loading preview/i)).toBeInTheDocument();
  });

  it('shows eligible count in suspend message after preview loads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ eligibleCount: 12 }),
      }),
    );
    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByText(/suspend 12 workspace account/i)).toBeInTheDocument();
    });
  });

  it('suspend dialog does NOT show irreversibility warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ eligibleCount: 5 }),
      }),
    );
    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByText(/suspend 5 workspace/i)).toBeInTheDocument();
    });

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('remove dialog shows irreversibility warning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ eligibleCount: 7 }),
      }),
    );
    renderDialog(REMOVE_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('note')).toBeInTheDocument();
    });

    expect(screen.getByRole('note')).toHaveTextContent(/cannot be undone/i);
  });

  it('Confirm button fires bulk-suspend with correct accountType', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 3 }),
      }) // GET preview
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: [1, 2, 3], failed: [] }),
      }); // POST bulk-suspend

    vi.stubGlobal('fetch', mockFetch);
    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm suspend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('bulk-suspend') &&
          c[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.accountType).toBe('workspace');
    });
  });

  it('Confirm button fires bulk-remove with correct accountType', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 4 }),
      }) // GET preview
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: [1, 2, 3, 4], failed: [] }),
      }); // POST bulk-remove

    vi.stubGlobal('fetch', mockFetch);
    renderDialog(REMOVE_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm remove/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('bulk-remove') &&
          c[1]?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.accountType).toBe('workspace');
    });
  });

  it('shows result panel with succeeded count after 200 response', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: [10, 11, 12, 13, 14], failed: [] }),
      });

    vi.stubGlobal('fetch', mockFetch);
    renderDialog(SUSPEND_CLAUDE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm suspend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));

    await waitFor(() => {
      expect(screen.getByText(/5 accounts? succeeded/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
  });

  it('shows failure list after 207 partial-failure response', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 207,
        json: async () => ({
          succeeded: [1],
          failed: [
            { accountId: 2, userId: 20, userName: 'Alice Smith', error: 'API timeout' },
            { accountId: 3, userId: 30, userName: 'Bob Jones', error: 'Not found' },
          ],
        }),
      });

    vi.stubGlobal('fetch', mockFetch);
    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm suspend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));

    await waitFor(() => {
      expect(screen.getByText(/1 account.? succeeded/i)).toBeInTheDocument();
      expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Bob Jones/i)).toBeInTheDocument();
    });
  });

  it('shows error message on 500 response', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 2 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      });

    vi.stubGlobal('fetch', mockFetch);
    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm suspend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/internal server error/i);
    });
  });

  it('shows error when preview fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Cohort not found' }),
      }),
    );

    renderDialog(SUSPEND_WORKSPACE_ACTION);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(/cohort not found/i);
    });
  });

  it('Done button calls onClose', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ eligibleCount: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ succeeded: [5], failed: [] }),
      });

    vi.stubGlobal('fetch', mockFetch);

    const onClose = vi.fn();
    renderDialog(SUSPEND_WORKSPACE_ACTION, onClose);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm suspend/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /confirm suspend/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
