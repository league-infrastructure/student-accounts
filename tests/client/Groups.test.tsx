/**
 * Tests for the Groups admin page component (Sprint 012 T005).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Groups from '../../client/src/pages/admin/Groups';

const SAMPLE_GROUPS = [
  {
    id: 1,
    name: 'Alpha',
    description: 'Top students',
    memberCount: 3,
    createdAt: '2026-01-15T00:00:00Z',
  },
  {
    id: 2,
    name: 'Beta',
    description: null,
    memberCount: 0,
    createdAt: '2026-02-10T00:00:00Z',
  },
];

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderGroups(queryClient?: QueryClient) {
  const client = queryClient ?? makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Groups />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Groups page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while fetching', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    renderGroups();
    expect(screen.getByText(/loading groups/i)).toBeInTheDocument();
  });

  it('shows empty state when no groups exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      }),
    );
    renderGroups();
    await waitFor(() =>
      expect(screen.getByText(/no groups yet/i)).toBeInTheDocument(),
    );
  });

  it('renders a search bar above the table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_GROUPS),
      }),
    );
    renderGroups();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByRole('searchbox', { name: /search groups/i })).toBeInTheDocument();
  });

  it('filters rows by name (case-insensitive)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_GROUPS),
      }),
    );
    renderGroups();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox', { name: /search groups/i }), {
      target: { value: 'alpha' },
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('filters rows by description', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_GROUPS),
      }),
    );
    renderGroups();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('searchbox', { name: /search groups/i }), {
      target: { value: 'top students' },
    });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('restores all rows when search is cleared', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_GROUPS),
      }),
    );
    renderGroups();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const searchBox = screen.getByRole('searchbox', { name: /search groups/i });
    fireEvent.change(searchBox, { target: { value: 'alpha' } });
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();

    fireEvent.change(searchBox, { target: { value: '' } });
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders table with name, description, member count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SAMPLE_GROUPS),
      }),
    );
    renderGroups();
    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Top students')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Zero-member group renders a 0.
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('opens the New Group dialog and submits, posting the body and navigating to the group page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 3,
          name: 'Gamma',
          description: 'd',
          memberCount: 0,
          createdAt: '2026-03-01T00:00:00Z',
        }),
      })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });

    vi.stubGlobal('fetch', fetchMock);
    renderGroups();

    await waitFor(() => expect(screen.getByText(/no groups yet/i)).toBeInTheDocument());

    // Dialog is closed by default — fields not yet present.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click "New +" — dialog opens.
    fireEvent.click(screen.getByRole('button', { name: /new group/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^group name$/i), { target: { value: 'Gamma' } });
    fireEvent.change(screen.getByLabelText(/^group description$/i), { target: { value: 'd' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1].body)).toEqual({ name: 'Gamma', description: 'd' });
    });
  });

  it('shows inline error on blank name without firing the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    vi.stubGlobal('fetch', fetchMock);
    renderGroups();
    await waitFor(() => expect(screen.getByText(/no groups yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new group/i }));
    fireEvent.change(screen.getByLabelText(/^group name$/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/must not be blank/i),
    );
    // No POST should have fired.
    expect(fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')).toBeUndefined();
  });

  it('shows inline error from API on duplicate', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: 'A group named "Dup" already exists.' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    renderGroups();
    await waitFor(() => expect(screen.getByText(/no groups yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new group/i }));
    fireEvent.change(screen.getByLabelText(/^group name$/i), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/already exists/i),
    );
  });
});
