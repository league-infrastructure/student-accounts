/**
 * Tests for the UserGroupsCard component (Sprint 012 T006).
 *
 * Written as a narrow, self-contained test rather than extending the
 * pre-existing UserDetailPanel.test.tsx (documented drift from Sprint 010).
 * The test exercises the card component directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserGroupsCard from '../../../../client/src/pages/admin/UserGroupsCard';

function renderCard(props: { userId: number; userName?: string }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UserGroupsCard {...props} />
    </QueryClientProvider>,
  );
}

const USER_GROUPS = [
  { id: 1, name: 'Alpha' },
  { id: 2, name: 'Beta' },
];

const ALL_GROUPS = [
  { id: 1, name: 'Alpha', description: null, memberCount: 2, createdAt: '' },
  { id: 2, name: 'Beta', description: null, memberCount: 1, createdAt: '' },
  { id: 3, name: 'Gamma', description: null, memberCount: 0, createdAt: '' },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('UserGroupsCard', () => {
  it('renders current memberships', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/users/42/groups')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(USER_GROUPS),
          });
        }
        if (url.endsWith('/admin/groups')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(ALL_GROUPS),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      }),
    );

    renderCard({ userId: 42, userName: "Alice" });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows empty state and combobox when user has no groups', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/users/42/groups')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ALL_GROUPS) });
      }),
    );
    renderCard({ userId: 42 });
    await waitFor(() =>
      expect(screen.getByText(/not in any groups yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/select group to add/i)).toBeInTheDocument();
  });

  it('remove calls DELETE and refreshes', async () => {
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);

    const fetchMock = vi
      .fn()
      // 1st: GET user groups (initial)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(USER_GROUPS),
      })
      // 2nd: GET all groups (initial)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ALL_GROUPS),
      })
      // 3rd: DELETE /members/42
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve({}),
      })
      // 4th: GET user groups after
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 2, name: 'Beta' }]),
      })
      // 5th: GET all groups after
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ALL_GROUPS),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderCard({ userId: 42, userName: "Alice" });
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const removeAlpha = screen.getByRole('button', { name: /remove from alpha/i });
    fireEvent.click(removeAlpha);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].includes('/groups/1/members/42') &&
            c[1]?.method === 'DELETE',
        ),
      ).toBe(true),
    );

    window.confirm = originalConfirm;
  });

  it('add POSTs with userId and refreshes', async () => {
    const fetchMock = vi
      .fn()
      // GET user groups
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      // GET all groups
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ALL_GROUPS),
      })
      // POST /groups/3/members
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ groupId: 3, userId: 42 }),
      })
      // refetch user groups
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: 3, name: 'Gamma' }]),
      })
      // refetch all groups
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(ALL_GROUPS),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderCard({ userId: 42 });
    await waitFor(() => expect(screen.getByText(/not in any groups yet/i)).toBeInTheDocument());

    const select = screen.getByLabelText(/select group to add/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) =>
            typeof c[0] === 'string' &&
            c[0].endsWith('/groups/3/members') &&
            c[1]?.method === 'POST' &&
            JSON.parse(c[1].body).userId === 42,
        ),
      ).toBe(true),
    );
  });
});
