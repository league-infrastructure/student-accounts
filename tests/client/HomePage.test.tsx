import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HomePage from '../../client/src/pages/HomePage';

// ---- Helpers ----

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderHomePage(fetchMock: ReturnType<typeof vi.fn>) {
  globalThis.fetch = fetchMock;
  const queryClient = makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const COUNTER_DATA = [
  { name: 'alpha', value: 3 },
  { name: 'beta', value: 7 },
];

// ---- Tests ----

describe('HomePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    // fetch that never resolves
    const fetchMock = vi.fn(() => new Promise(() => {}));
    renderHomePage(fetchMock);
    expect(screen.getByText(/loading counters/i)).toBeInTheDocument();
  });

  it('renders counter names and values after fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(COUNTER_DATA),
    });

    renderHomePage(fetchMock);

    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('beta')).toBeInTheDocument();
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('renders error state when fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    renderHomePage(fetchMock);

    await waitFor(() => {
      expect(screen.getByText(/failed to load counters/i)).toBeInTheDocument();
    });
  });

  it('clicking "Bump alpha" calls POST /api/counters/alpha/increment', async () => {
    const user = userEvent.setup();

    let callCount = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      callCount++;
      if (options?.method === 'POST') {
        // Increment response — return updated alpha counter
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name: 'alpha', value: 4 }),
        });
      }
      // GET /api/counters
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(COUNTER_DATA),
      });
    });

    renderHomePage(fetchMock);

    // Wait for counters to load
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeInTheDocument();
    });

    // Click Bump alpha
    await user.click(screen.getByRole('button', { name: /bump alpha/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('/api/counters/alpha/increment') &&
          opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
    });
  });

  it('clicking "Bump beta" calls POST /api/counters/beta/increment', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name: 'beta', value: 8 }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(COUNTER_DATA),
      });
    });

    renderHomePage(fetchMock);

    await waitFor(() => {
      expect(screen.getByText('beta')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /bump beta/i }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          typeof url === 'string' &&
          url.includes('/api/counters/beta/increment') &&
          opts?.method === 'POST',
      );
      expect(postCall).toBeDefined();
    });
  });

  it('after successful increment, counters are refetched', async () => {
    const user = userEvent.setup();

    // First GET returns value 3, second GET (refetch) returns 4
    let getCallCount = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ name: 'alpha', value: 4 }),
        });
      }
      getCallCount++;
      const alphaValue = getCallCount > 1 ? 4 : 3;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            { name: 'alpha', value: alphaValue },
            { name: 'beta', value: 7 },
          ]),
      });
    });

    renderHomePage(fetchMock);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /bump alpha/i }));

    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });
});
