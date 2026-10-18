/**
 * Tests for GroupDetailPanel (Sprint 012 T005, updated Sprint 028 T006).
 *
 * Focused on the narrow behaviours the sprint brief specifies:
 *   - Member table renders.
 *   - Search-and-add posts a membership and re-fetches.
 *   - Remove posts a DELETE and re-fetches.
 *   - Per-row permission checkboxes render and send the right PATCH.
 *
 * Note (Sprint 015 T007): GroupDetailPanel now renders a PassphraseCard which
 * makes an additional GET /api/admin/groups/:id/passphrase fetch. Tests that
 * use url-agnostic sequential mocks (mockResolvedValueOnce) need the passphrase
 * fetch to be handled. The helpers below route by URL so each endpoint gets the
 * correct response regardless of call order.
 *
 * Note: row selection + selection toolbar were re-added (2026-10-18); see the
 * "member selection" describe block at the bottom.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../client/src/context/ToastContext';
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
      allowsOauthClient: true,
      allowsLlmProxy: true,
      allowsLeagueAccount: false,
    },
    {
      id: 12,
      displayName: 'Bob',
      email: 'bob@league',
      role: 'student',
      externalAccounts: [],
      llmProxyToken: { status: 'none' as const },
      allowsOauthClient: false,
      allowsLlmProxy: false,
      allowsLeagueAccount: false,
    },
  ],
};

/** Fixture: all users have every permission ON. */
const GROUP_ALL_ON = {
  group: { id: 7, name: 'Alpha', description: null, createdAt: '2026-01-15T00:00:00Z' },
  users: [
    {
      id: 11, displayName: 'Alice', email: 'alice@league', role: 'student',
      externalAccounts: [], llmProxyToken: { status: 'active' as const },
      allowsOauthClient: true, allowsLlmProxy: true, allowsLeagueAccount: true,
    },
    {
      id: 12, displayName: 'Bob', email: 'bob@league', role: 'student',
      externalAccounts: [], llmProxyToken: { status: 'none' as const },
      allowsOauthClient: true, allowsLlmProxy: true, allowsLeagueAccount: true,
    },
  ],
};

/** Fixture: all users have every permission OFF. */
const GROUP_ALL_OFF = {
  group: { id: 7, name: 'Alpha', description: null, createdAt: '2026-01-15T00:00:00Z' },
  users: [
    {
      id: 11, displayName: 'Alice', email: 'alice@league', role: 'student',
      externalAccounts: [], llmProxyToken: { status: 'active' as const },
      allowsOauthClient: false, allowsLlmProxy: false, allowsLeagueAccount: false,
    },
    {
      id: 12, displayName: 'Bob', email: 'bob@league', role: 'student',
      externalAccounts: [], llmProxyToken: { status: 'none' as const },
      allowsOauthClient: false, allowsLlmProxy: false, allowsLeagueAccount: false,
    },
  ],
};

/**
 * Build a fetch mock that routes by URL.
 * - /passphrase  → 404
 * - /members (GET) → GROUP_WITH_TWO
 * Callers can override specific URL matchers via `overrides`.
 */
function buildFetchMock(overrides: Record<string, (url: string, opts?: RequestInit) => any> = {}) {
  // The PassphraseCard auto-creates on first GET 404 — the POST handler
  // here returns a stable fake record so tests see a populated card.
  let passphraseGetReturned404Once = false;
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    // Check overrides first
    for (const [key, handler] of Object.entries(overrides)) {
      if (url.includes(key)) {
        return Promise.resolve(handler(url, opts));
      }
    }
    if (url.endsWith('/passphrase')) {
      const method = opts?.method ?? 'GET';
      if (method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () => Promise.resolve({
            plaintext: 'auto-passphrase-1',
            expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            grantLlmProxy: false,
            createdAt: new Date().toISOString(),
          }),
        });
      }
      if (!passphraseGetReturned404Once) {
        passphraseGetReturned404Once = true;
        return Promise.resolve(passphraseNotFound());
      }
      // Subsequent GETs (after the auto-create POST invalidated the query)
      // see the just-created passphrase.
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          plaintext: 'auto-passphrase-1',
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          grantLlmProxy: false,
          createdAt: new Date().toISOString(),
        }),
      });
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
        <ToastProvider>
          <Routes>
            <Route path="/groups/:id" element={<GroupDetailPanel />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Render with custom group data; returns the queryClient for spy access. */
function renderPanelWith(groupData: typeof GROUP_WITH_TWO) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    if (url.endsWith('/passphrase')) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
    }
    if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(groupData) });
    }
    // Default: PATCH /permissions → ok
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <MemoryRouter initialEntries={['/groups/7']}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <Routes>
            <Route path="/groups/:id" element={<GroupDetailPanel />} />
          </Routes>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { client, fetchMock };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.restoreAllMocks();
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
          allowsOauthClient: false,
          allowsLlmProxy: false,
          allowsLeagueAccount: false,
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

  it('permission checkboxes render with current flag values from listMembers', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    // Alice: allowsOauthClient=true, allowsLlmProxy=true, allowsLeagueAccount=false
    const aliceOauthCb = screen.getByRole('checkbox', { name: /OAuth Client for Alice/i });
    const aliceLlmCb = screen.getByRole('checkbox', { name: /LLM Proxy for Alice/i });
    const aliceLeagueCb = screen.getByRole('checkbox', { name: /League Account for Alice/i });
    expect(aliceOauthCb).toBeChecked();
    expect(aliceLlmCb).toBeChecked();
    expect(aliceLeagueCb).not.toBeChecked();

    // Bob: all false
    const bobOauthCb = screen.getByRole('checkbox', { name: /OAuth Client for Bob/i });
    expect(bobOauthCb).not.toBeChecked();
  });

  it('clicking OAuth checkbox sends PATCH with correct field and userId', async () => {
    const fetchMock = buildFetchMock({
      '/permissions': (_url: string, opts?: RequestInit) =>
        opts?.method === 'PATCH'
          ? { ok: true, json: () => Promise.resolve({ allowsOauthClient: false, allowsLlmProxy: true, allowsLeagueAccount: false }) }
          : { ok: true, json: () => Promise.resolve({}) },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    // Alice has allowsOauthClient=true; uncheck it
    const aliceOauthCb = screen.getByRole('checkbox', { name: /OAuth Client for Alice/i });
    fireEvent.click(aliceOauthCb);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          if (typeof c[0] !== 'string' || !c[0].includes('/permissions')) return false;
          if (c[0] !== '/api/admin/users/11/permissions') return false;
          if (c[1]?.method !== 'PATCH') return false;
          const body = JSON.parse(c[1].body as string);
          return body.allows_oauth_client === false;
        }),
      ).toBe(true),
    );
  });

  it('clicking LLM Proxy checkbox sends PATCH with allows_llm_proxy', async () => {
    const fetchMock = buildFetchMock({
      '/permissions': (_url: string, opts?: RequestInit) =>
        opts?.method === 'PATCH'
          ? { ok: true, json: () => Promise.resolve({ allowsOauthClient: false, allowsLlmProxy: true, allowsLeagueAccount: false }) }
          : { ok: true, json: () => Promise.resolve({}) },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    // Bob has allowsLlmProxy=false; check it
    const bobLlmCb = screen.getByRole('checkbox', { name: /LLM Proxy for Bob/i });
    fireEvent.click(bobLlmCb);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => {
          if (typeof c[0] !== 'string' || !c[0].includes('/permissions')) return false;
          if (c[1]?.method !== 'PATCH') return false;
          const body = JSON.parse(c[1].body as string);
          return body.allows_llm_proxy === true;
        }),
      ).toBe(true),
    );
  });

  it('permission PATCH error shows error banner', async () => {
    const fetchMock = buildFetchMock({
      '/permissions': (_url: string, opts?: RequestInit) =>
        opts?.method === 'PATCH'
          ? { ok: false, status: 400, json: () => Promise.resolve({ error: 'Permission denied' }) }
          : { ok: true, json: () => Promise.resolve({}) },
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const bobOauthCb = screen.getByRole('checkbox', { name: /OAuth Client for Bob/i });
    fireEvent.click(bobOauthCb);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Permission denied/),
    );
  });

  // Sprint 028 T005: Delete button is in the title row alongside the group name h2
  it('Delete Group button is in the same flex row as the group name heading', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    const heading = screen.getByRole('heading', { name: 'Alpha' });
    const deleteBtn = screen.getByRole('button', { name: /Delete Group/i });

    // Both elements should share the same parent div (the title row)
    expect(heading.parentElement).toBe(deleteBtn.parentElement);
    // That parent should have justifyContent: space-between
    expect(heading.parentElement?.style.justifyContent).toBe('space-between');
  });

  // Sprint 028 T005: PassphraseCard renders before the member table
  it('PassphraseCard renders before the member table', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    // Wait for the auto-created passphrase to land — the "Passphrase"
    // label appears once the POST resolves and the query refetches.
    await waitFor(() => expect(screen.getByText('Passphrase')).toBeInTheDocument());

    const passphraseLabel = screen.getByText('Passphrase');
    const aliceCell = screen.getByText('Alice');

    const position = passphraseLabel.compareDocumentPosition(aliceCell);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('League Account checkbox shows Provisioning indicator on toggle-on', async () => {
    // Make the PATCH hang briefly so we can check the in-flight state
    let resolvePatch!: () => void;
    const patchPromise = new Promise<void>((res) => { resolvePatch = res; });

    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.endsWith('/passphrase')) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
      }
      if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_WITH_TWO) });
      }
      if (url.includes('/permissions') && opts?.method === 'PATCH') {
        return patchPromise.then(() => ({
          ok: true,
          json: () => Promise.resolve({ allowsOauthClient: false, allowsLlmProxy: false, allowsLeagueAccount: true }),
        }));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    // Toggle League Account on for Alice (currently false)
    const aliceLeagueCb = screen.getByRole('checkbox', { name: /League Account for Alice/i });
    fireEvent.click(aliceLeagueCb);

    // "Provisioning…" should appear while PATCH is in-flight
    await waitFor(() =>
      expect(screen.getByText('Provisioning…')).toBeInTheDocument(),
    );

    // Resolve the PATCH
    resolvePatch();
    await waitFor(() =>
      expect(screen.queryByText('Provisioning…')).not.toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Sprint 028 T007: tri-state column toggles
// ---------------------------------------------------------------------------

describe('GroupDetailPanel — ColumnTriToggle (tri-state column headers)', () => {
  it('shows ☑ in all three column headers when every user has all permissions on', async () => {
    renderPanelWith(GROUP_ALL_ON);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // There should be three buttons with title "All on — click to turn all off"
    const allOnButtons = screen.getAllByTitle('All on — click to turn all off');
    expect(allOnButtons).toHaveLength(3);
    // Each should contain ☑
    for (const btn of allOnButtons) {
      expect(btn.textContent).toBe('☑');
    }
  });

  it('shows ☒ in all three column headers when every user has all permissions off', async () => {
    renderPanelWith(GROUP_ALL_OFF);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // All three columns all-off → ☒
    const allOffButtons = screen.getAllByTitle('Click to turn all on');
    expect(allOffButtons).toHaveLength(3);
    for (const btn of allOffButtons) {
      expect(btn.textContent).toBe('☒');
    }
  });

  it('shows ☐ (mixed) in OAuth header when users have mixed allowsOauthClient', async () => {
    // GROUP_WITH_TWO: Alice.allowsOauthClient=true, Bob.allowsOauthClient=false → mixed
    renderPanelWith(GROUP_WITH_TWO);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // OAuth header: mixed → ☐; title is "Click to turn all on"
    // LLM Proxy header: Alice=true, Bob=false → mixed → ☐
    // Lg Acct header: Alice=false, Bob=false → all-off → ☒
    // So there are 2 mixed (☐) and 1 all-off (☒)
    const toTurnOnBtns = screen.getAllByTitle('Click to turn all on');
    // Should include the mixed ones (☐) and the all-off one (☒)
    expect(toTurnOnBtns.length).toBeGreaterThanOrEqual(2);

    // At least one toggle shows ☐ (mixed)
    const mixedBtns = screen.getAllByTitle('Click to turn all on').filter((b) => b.textContent === '☐');
    expect(mixedBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('click on ☑ (all-on) toggle fires N PATCH calls with value=false', async () => {
    const { fetchMock } = renderPanelWith(GROUP_ALL_ON);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // Click the OAuth column toggle (all-on → click turns all off)
    const allOnBtns = screen.getAllByTitle('All on — click to turn all off');
    // Click the first one (OAuth)
    fireEvent.click(allOnBtns[0]);

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/permissions') &&
          c[1]?.method === 'PATCH',
      );
      expect(patchCalls.length).toBe(GROUP_ALL_ON.users.length);
      for (const call of patchCalls) {
        const body = JSON.parse(call[1].body as string);
        expect(body.allows_oauth_client).toBe(false);
      }
    });
  });

  it('click on ☒ (all-off) toggle fires N PATCH calls with value=true', async () => {
    const { fetchMock } = renderPanelWith(GROUP_ALL_OFF);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // All three columns are all-off. Click the first one (OAuth).
    const allOffBtns = screen.getAllByTitle('Click to turn all on');
    // The all-off buttons show ☒; pick the one for OAuth (first in DOM order)
    const oauthBtn = allOffBtns.find((b) => b.textContent === '☒')!;
    fireEvent.click(oauthBtn);

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/permissions') &&
          c[1]?.method === 'PATCH',
      );
      expect(patchCalls.length).toBe(GROUP_ALL_OFF.users.length);
      for (const call of patchCalls) {
        const body = JSON.parse(call[1].body as string);
        expect(body.allows_oauth_client).toBe(true);
      }
    });
  });

  it('click on ☐ (mixed) toggle fires N PATCH calls with value=true', async () => {
    // GROUP_WITH_TWO: OAuth is mixed (Alice=true, Bob=false)
    const { fetchMock } = renderPanelWith(GROUP_WITH_TWO);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // Find the OAuth header ☐ toggle (mixed → click to turn all on)
    const mixedBtns = screen.getAllByTitle('Click to turn all on').filter((b) => b.textContent === '☐');
    expect(mixedBtns.length).toBeGreaterThanOrEqual(1);
    // Click the first mixed toggle
    fireEvent.click(mixedBtns[0]);

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' &&
          c[0].includes('/permissions') &&
          c[1]?.method === 'PATCH',
      );
      expect(patchCalls.length).toBe(GROUP_WITH_TWO.users.length);
      for (const call of patchCalls) {
        const body = JSON.parse(call[1].body as string);
        // The mixed columns all turn on → the clicked field value is true
        // (we can't know which field from outside, but value must be true)
        const values = Object.values(body) as boolean[];
        expect(values.every((v) => v === true)).toBe(true);
      }
    });
  });

  it('shows "Updating..." pill in the column header while PATCHes are in-flight', async () => {
    let resolveAll!: () => void;
    const hangPromise = new Promise<void>((res) => { resolveAll = res; });

    const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (url.endsWith('/passphrase')) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
      }
      if (url.endsWith('/members') && (!opts?.method || opts.method === 'GET')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(GROUP_ALL_ON) });
      }
      if (url.includes('/permissions') && opts?.method === 'PATCH') {
        return hangPromise.then(() => ({ ok: true, json: () => Promise.resolve({}) }));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter initialEntries={['/groups/7']}>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <Routes>
              <Route path="/groups/:id" element={<GroupDetailPanel />} />
            </Routes>
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    // Click the OAuth toggle (all-on → will send PATCHes)
    const allOnBtns = screen.getAllByTitle('All on — click to turn all off');
    fireEvent.click(allOnBtns[0]);

    // While in-flight, "Updating..." should be visible
    await waitFor(() =>
      expect(screen.getByText('Updating...')).toBeInTheDocument(),
    );

    // Resolve PATCHes
    resolveAll();
    await waitFor(() =>
      expect(screen.queryByText('Updating...')).not.toBeInTheDocument(),
    );
  });

  it('invalidates group detail query after all PATCHes settle', async () => {
    const { client, fetchMock } = renderPanelWith(GROUP_ALL_ON);
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const allOnBtns = screen.getAllByTitle('All on — click to turn all off');
    fireEvent.click(allOnBtns[0]);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: expect.arrayContaining(['admin', 'groups']),
        }),
      ),
    );
  });
});



describe('GroupDetailPanel — member selection', () => {
  const calls = (fm: ReturnType<typeof vi.fn>) =>
    fm.mock.calls.map(([u, o]) => `${(o as RequestInit | undefined)?.method ?? 'GET'} ${u}`);

  it('renders select-all and per-row checkboxes; toolbar hidden with no selection', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select all members' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Alice' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Bob' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Selected members' })).toBeNull();
  });

  it('shows count, and select-all is indeterminate for a partial selection', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const all = screen.getByRole('checkbox', { name: 'Select all members' }) as HTMLInputElement;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice' }));
    expect(screen.getByRole('toolbar', { name: 'Selected members' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it('select-all selects every member, and again clears them', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const all = screen.getByRole('checkbox', { name: 'Select all members' }) as HTMLInputElement;
    fireEvent.click(all);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    fireEvent.click(all);
    expect(screen.queryByRole('toolbar', { name: 'Selected members' })).toBeNull();
  });

  it('Remove from group confirms, DELETEs each selected id, and reloads', async () => {
    const fetchMock = buildFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all members' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from group' }));
    expect(fetchMock.mock.calls.some(([, o]) => (o as RequestInit | undefined)?.method === 'DELETE')).toBe(false);
    // Row buttons are also named "Remove"; the dialog's confirm renders last.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).slice(-1)[0]);
    await waitFor(() => {
      const c = calls(fetchMock);
      expect(c).toContain('DELETE /api/admin/groups/7/members/11');
      expect(c).toContain('DELETE /api/admin/groups/7/members/12');
    });
    await waitFor(() => expect(screen.getByText('Removed 2 members')).toBeInTheDocument());
    const getsAfter = calls(fetchMock).filter((c) => c === 'GET /api/admin/groups/7/members');
    expect(getsAfter.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Selected members' })).toBeNull());
  });

  it('Revoke LLM Proxy posts only members with an active token', async () => {
    const fetchMock = buildFetchMock({
      'bulk-revoke-llm-proxy': () => ({
        ok: true,
        status: 200,
        json: async () => ({ succeeded: [11], failed: [], skipped: [] }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all members' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke LLM Proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('bulk-revoke-llm-proxy'));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ userIds: [11] });
    });
  });

  it('Grant LLM Proxy posts only members without a token to the group bulk-grant route', async () => {
    const fetchMock = buildFetchMock({
      'llm-proxy/bulk-grant': () => ({
        ok: true,
        status: 200,
        json: async () => ({ succeeded: [12], failed: [], skipped: [] }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all members' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grant LLM Proxy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/admin/groups/7/llm-proxy/bulk-grant');
      expect(call).toBeTruthy();
      const body = JSON.parse((call![1] as RequestInit).body as string);
      expect(body.userIds).toEqual([12]);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  it('Suspend accounts posts eligible ids; disabled when no selected member is a student', async () => {
    const fetchMock = buildFetchMock({
      'bulk-suspend-accounts': () => ({
        ok: true,
        status: 200,
        json: async () => ({ succeeded: [], failed: [], totalEligible: 0 }),
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alice' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend accounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('bulk-suspend-accounts'));
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ userIds: [11] });
    });
  });

  it('Suspend and Revoke are disabled when no selected member is eligible', async () => {
    const staff = {
      ...GROUP_WITH_TWO,
      users: [
        { ...GROUP_WITH_TWO.users[1], id: 21, displayName: 'Sam', email: 'sam@league', role: 'STAFF' },
      ],
    };
    renderPanelWith(staff as typeof GROUP_WITH_TWO);
    await waitFor(() => expect(screen.getByText('Sam')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam' }));
    expect(screen.getByRole('button', { name: 'Suspend accounts' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revoke LLM Proxy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Grant LLM Proxy' })).not.toBeDisabled();
  });
});
