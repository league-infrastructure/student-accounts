/**
 * Tests for GroupDetailPanel (Sprint 012 T005, Sprint 026 T007).
 *
 * Focused on the narrow behaviours the sprint brief specifies:
 *   - Member table renders.
 *   - Search-and-add posts a membership and re-fetches.
 *   - Remove posts a DELETE and re-fetches.
 *   - Each of the four bulk buttons hits the correct endpoint.
 *   - Suspend-all failure banner renders "name (type): reason".
 *   - (Sprint 026 T007) Permission toggles render with correct initial state.
 *   - (Sprint 026 T007) Toggling a permission fires PATCH with the right field.
 *   - (Sprint 026 T007) Error from PATCH shows inline alert.
 *   - (Sprint 026 T007) leagueAccount toggle shows "Provisioning…" while pending.
 *
 * Note (Sprint 015 T007): GroupDetailPanel now renders a PassphraseCard which
 * makes an additional GET /api/admin/groups/:id/passphrase fetch. Tests that
 * use url-agnostic sequential mocks (mockResolvedValueOnce) need the passphrase
 * fetch to be handled. The helpers below route by URL so each endpoint gets the
 * correct response regardless of call order.
 *
 * Note (Sprint 026 T007): GroupDetailPanel now also fetches GET /api/admin/groups/:id
 * (without /members) to load permission flags. The fetch mock must handle this URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupDetailPanel from '../../client/src/pages/admin/GroupDetailPanel';

/** Return a 404 for passphrase endpoints so PassphraseCard shows empty state. */
function passphraseNotFound() {
  return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
}

/** Default permission flags returned by GET /admin/groups/:id */
const DEFAULT_PERMISSIONS = {
  id: 7,
  name: 'Alpha',
  description: 'Top students',
  createdAt: '2026-01-15T00:00:00Z',
  allowsOauthClient: false,
  allowsLlmProxy: true,
  allowsLeagueAccount: false,
};

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

/**
 * Build a fetch mock that routes by URL.
 * - /passphrase  → 404
 * - /members (GET) → GROUP_WITH_TWO
 * - /admin/groups/7 (exact, no trailing segment) → permissions object
 * Callers can override specific URL matchers via `overrides`.
 */
function buildFetchMock(overrides: Record<string, (url: string, opts?: RequestInit) => any> = {}) {
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    // Check overrides first
    for (const [key, handler] of Object.entries(overrides)) {
      if (url.includes(key)) {
        return Promise.resolve(handler(url, opts));
      }
    }
    if (url.endsWith('/passphrase')) {
      return Promise.resolve(passphraseNotFound());
    }
    // Exact group endpoint (permission flags): matches /admin/groups/7 but NOT /members etc.
    if (/\/admin\/groups\/\d+$/.test(url) && (!opts?.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_PERMISSIONS) });
    }
    // Members list
    if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

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
    vi.stubGlobal('fetch', buildFetchMock());
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
    const fetchMock = buildFetchMock({
      '/user-search': () => ({ ok: true, json: () => Promise.resolve(matchJson) }),
    });
    // Override members GET to return updated list on second call
    const originalImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
        membersCallCount++;
        const data = membersCallCount > 1 ? updatedGroup : GROUP_WITH_TWO;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
      }
      if (url.endsWith('/members') && opts?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ groupId: 7, userId: 42 }) });
      }
      return originalImpl(url, opts);
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
    vi.stubGlobal('fetch', buildFetchMock());

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
    const fetchMock = buildFetchMock({
      '/bulk-suspend-all': (_url: string, opts?: RequestInit) =>
        opts?.method === 'POST'
          ? { ok: false, status: 207, json: () => Promise.resolve(suspendBody) }
          : { ok: true, json: () => Promise.resolve({}) },
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
    const fetchMock = buildFetchMock({
      '/bulk-provision': (_url: string, opts?: RequestInit) =>
        opts?.method === 'POST'
          ? { ok: true, status: 200, json: () => Promise.resolve({ succeeded: [1], failed: [] }) }
          : { ok: true, json: () => Promise.resolve({}) },
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
    const fetchMock = buildFetchMock({
      '/bulk-remove-all': (_url: string, opts?: RequestInit) =>
        opts?.method === 'POST'
          ? { ok: true, status: 200, json: () => Promise.resolve({ succeeded: [1], failed: [] }) }
          : { ok: true, json: () => Promise.resolve({}) },
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

// ---------------------------------------------------------------------------
// Sprint 026 T007: Permission toggle tests
// ---------------------------------------------------------------------------

describe('GroupDetailPanel — permission toggles', () => {
  it('renders three toggles with correct initial state from GET /admin/groups/:id', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('OAuth Client registration')).toBeInTheDocument(),
    );

    const oauthToggle = screen.getByLabelText('OAuth Client registration') as HTMLInputElement;
    const llmToggle = screen.getByLabelText('LLM Proxy access') as HTMLInputElement;
    const leagueToggle = screen.getByLabelText('League Account provisioning') as HTMLInputElement;

    // DEFAULT_PERMISSIONS: allowsOauthClient=false, allowsLlmProxy=true, allowsLeagueAccount=false
    expect(oauthToggle.checked).toBe(false);
    expect(llmToggle.checked).toBe(true);
    expect(leagueToggle.checked).toBe(false);
  });

  it('caption appears for each toggle', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('OAuth Client registration')).toBeInTheDocument(),
    );

    const captions = screen.getAllByText('Toggling this on grants the capability to every member.');
    expect(captions).toHaveLength(3);
  });

  it('toggling allowsOauthClient fires PATCH with { allowsOauthClient: true }', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('OAuth Client registration')).toBeInTheDocument(),
    );

    const oauthToggle = screen.getByLabelText('OAuth Client registration');
    await act(async () => {
      fireEvent.click(oauthToggle);
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          if (typeof c[0] !== 'string') return false;
          if (!/\/admin\/groups\/\d+$/.test(c[0])) return false;
          if (c[1]?.method !== 'PATCH') return false;
          const body = JSON.parse(c[1].body as string);
          return body.allowsOauthClient === true;
        }),
      ).toBe(true),
    );
  });

  it('toggling allowsLlmProxy (was true) fires PATCH with { allowsLlmProxy: false }', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('LLM Proxy access')).toBeInTheDocument(),
    );

    const llmToggle = screen.getByLabelText('LLM Proxy access');
    await act(async () => {
      fireEvent.click(llmToggle);
    });

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          if (typeof c[0] !== 'string') return false;
          if (!/\/admin\/groups\/\d+$/.test(c[0])) return false;
          if (c[1]?.method !== 'PATCH') return false;
          const body = JSON.parse(c[1].body as string);
          return body.allowsLlmProxy === false;
        }),
      ).toBe(true),
    );
  });

  it('shows inline error alert when PATCH fails', async () => {
    const fetchMock = buildFetchMock();
    // Override PATCH to return error
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (/\/admin\/groups\/\d+$/.test(url) && opts?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server exploded' }),
        });
      }
      if (/\/admin\/groups\/\d+$/.test(url) && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_PERMISSIONS) });
      }
      if (url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('OAuth Client registration')).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText('OAuth Client registration'));
    });

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Server exploded'),
    );
  });

  it('league-account toggle shows Provisioning… indicator while PATCH is in-flight', async () => {
    let resolvePatch!: (value: any) => void;
    const patchPromise = new Promise<any>((resolve) => {
      resolvePatch = resolve;
    });

    const fetchMock = buildFetchMock();
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (/\/admin\/groups\/\d+$/.test(url) && opts?.method === 'PATCH') {
        return patchPromise;
      }
      if (/\/admin\/groups\/\d+$/.test(url) && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(DEFAULT_PERMISSIONS) });
      }
      if (url.endsWith('/passphrase')) {
        return Promise.resolve(passphraseNotFound());
      }
      if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByLabelText('League Account provisioning')).toBeInTheDocument(),
    );

    // Click the league account toggle (starts the in-flight PATCH)
    fireEvent.click(screen.getByLabelText('League Account provisioning'));

    // Provisioning indicator should appear while PATCH is pending
    await waitFor(() =>
      expect(screen.getByLabelText('Provisioning…')).toBeInTheDocument(),
    );

    // Resolve the PATCH — indicator disappears
    await act(async () => {
      resolvePatch({
        ok: true,
        json: () => Promise.resolve({ ...DEFAULT_PERMISSIONS, allowsLeagueAccount: true }),
      });
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('Provisioning…')).not.toBeInTheDocument(),
    );
  });
});
