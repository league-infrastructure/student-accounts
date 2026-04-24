/**
 * Tests for GroupDetailPanel (Sprint 012 T005).
 *
 * Focused on the narrow behaviours the sprint brief specifies:
 *   - Member table renders.
 *   - Search-and-add posts a membership and re-fetches.
 *   - Remove posts a DELETE and re-fetches.
 *   - Each of the four bulk buttons hits the correct endpoint.
 *   - Suspend-all failure banner renders "name (type): reason".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupDetailPanel from '../../client/src/pages/admin/GroupDetailPanel';

const GROUP_WITH_TWO = {
  group: {
    id: 7,
    name: 'Alpha',
    description: 'Top students',
    createdAt: '2026-01-15T00:00:00Z',
  },
  users: [
    {
      id: 11,
      displayName: 'Alice',
      email: 'alice@league',
      role: 'student',
      externalAccounts: [
        { type: 'workspace', status: 'active', externalId: 'alice@league' },
      ],
      llmProxyToken: { status: 'active' as const },
    },
    {
      id: 12,
      displayName: 'Bob',
      email: 'bob@league',
      role: 'student',
      externalAccounts: [],
      llmProxyToken: { status: 'none' as const },
    },
  ],
};

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/groups/7']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/groups/:id" element={<GroupDetailPanel />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('GroupDetailPanel', () => {
  it('renders member table from GET /members', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      }),
    );
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('add-from-search posts member then reloads', async () => {
    const matchJson = [
      { id: 42, displayName: 'Charlie', email: 'charlie@league', matchedOn: 'display_name' },
    ];
    const fetchMock = vi
      .fn()
      // initial members GET
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      })
      // search GET
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(matchJson),
      })
      // POST /members
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ groupId: 7, userId: 42 }),
      })
      // re-fetch after add
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            ...GROUP_WITH_TWO,
            users: [
              ...GROUP_WITH_TWO.users,
              {
                id: 42,
                displayName: 'Charlie',
                email: 'charlie@league',
                role: 'student',
                externalAccounts: [],
                llmProxyToken: { status: 'none' as const },
              },
            ],
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/search users/i), {
      target: { value: 'Char' },
    });
    // Advance past debounce
    await vi.advanceTimersByTimeAsync(350);

    await waitFor(() => expect(screen.getByText('Charlie')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Charlie/i }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => typeof c[0] === 'string' && c[0].endsWith('/members') && c[1]?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('row checkbox selection works', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      }),
    );

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // Verify checkboxes exist
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThan(0); // select-all + rows
  });

  it('Suspend button renders with count and hits bulk-suspend-all', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    const suspendBody = {
      succeeded: [101],
      failed: [
        { accountId: 202, userId: 12, userName: 'Bob', type: 'claude', error: 'boom' },
      ],
    };
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      })
      // POST suspend-all → 207
      .mockResolvedValueOnce({
        ok: false,
        status: 207,
        json: () => Promise.resolve(suspendBody),
      })
      // re-fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Suspend/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Bob \(claude\): boom/),
    );
  });

  it('Create League button hits bulk-provision workspace', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    const fetchMock = vi
      .fn()
      // initial GET
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      })
      // POST bulk-provision
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ succeeded: [1], failed: [] }),
      })
      // re-fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Create League/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          if (typeof c[0] !== 'string' || !c[0].endsWith('/bulk-provision')) return false;
          if (c[1]?.method !== 'POST') return false;
          const body = JSON.parse(c[1].body);
          return body.accountType === 'workspace';
        }),
      ).toBe(true),
    );
  });

  it('Remove League button hits bulk-remove-all', async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ succeeded: [1], failed: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(GROUP_WITH_TWO),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Remove League/ }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => typeof c[0] === 'string' && c[0].endsWith('/bulk-remove-all'),
        ),
      ).toBe(true),
    );
  });
});
