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
 * Note (Sprint 028 T006): Bulk-action toolbar and row-selection column have
 * been removed from the component. Tests for those features are deleted here.
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

/**
 * Build a fetch mock that routes by URL.
 * - /passphrase  → 404
 * - /members (GET) → GROUP_WITH_TWO
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

  it('bulk-action buttons are not rendered', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /Create League/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove League/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Suspend/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Grant LLM Proxy/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke LLM Proxy/i })).toBeNull();
  });

  it('select-all and per-row select checkboxes are not rendered', async () => {
    vi.stubGlobal('fetch', buildFetchMock());
    renderPanel();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());

    expect(screen.queryByRole('checkbox', { name: /Select all members/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Select Alice/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Select Bob/i })).toBeNull();
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
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());

    // PassphraseCard renders a "Passphrase" label; member table contains "Alice"
    const passphraseLabel = screen.getByText('Passphrase');
    const aliceCell = screen.getByText('Alice');

    // Compare DOM position: passphrase label should appear before Alice in document order
    const position = passphraseLabel.compareDocumentPosition(aliceCell);
    // DOCUMENT_POSITION_FOLLOWING = 4, means aliceCell comes after passphraseLabel
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

