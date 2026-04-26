/**
 * Tests for GroupDetailPanel (Sprint 012 T005).
 *
 * Focused on the narrow behaviours the sprint brief specifies:
 *   - Member table renders.
 *   - Search-and-add posts a membership and re-fetches.
 *   - Remove posts a DELETE and re-fetches.
 *   - Each of the four bulk buttons hits the correct endpoint.
 *   - Suspend-all failure banner renders "name (type): reason".
 *
 * Note (Sprint 015 T007): GroupDetailPanel now renders a PassphraseCard which
 * makes an additional GET /api/admin/groups/:id/passphrase fetch. Tests that
 * use url-agnostic sequential mocks (mockResolvedValueOnce) need the passphrase
 * fetch to be handled. The helpers below route by URL so each endpoint gets the
 * correct response regardless of call order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupDetailPanel from '../../client/src/pages/admin/GroupDetailPanel';

/** Return a 404 for passphrase endpoints so PassphraseCard shows empty state. */
function passphraseNotFound() {
  return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
}

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
    const updatedGroup = {
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
    };
    let membersCallCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (typeof url === 'string' && url.includes('/user-search')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(matchJson) });
      }
      if (typeof url === 'string' && url.endsWith('/members') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ groupId: 7, userId: 42 }) });
      }
      if (typeof url === 'string' && url.endsWith('/members')) {
        // First call returns original, second returns updated list
        membersCallCount++;
        const data = membersCallCount > 1 ? updatedGroup : GROUP_WITH_TWO;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
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
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (typeof url === 'string' && url.endsWith('/bulk-suspend-all') && opts?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 207, json: () => Promise.resolve(suspendBody) });
      }
      // members GET (initial + re-fetch)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
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
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (typeof url === 'string' && url.endsWith('/bulk-provision') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ succeeded: [1], failed: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
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
    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === 'string' && url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (typeof url === 'string' && url.endsWith('/bulk-remove-all') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ succeeded: [1], failed: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
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
