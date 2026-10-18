/**
 * Tests for the admin UserLlmProxyCard (sprint 003, ticket 005; first
 * written in Sprint 013 T005).
 *
 *  - Disabled: status pill, Grant access → LlmProxyGrantModal with a $5
 *    default budget → POST { expiresAt, budgetUsd }; status refetched.
 *  - Enabled: dollar meter and `$x of $y … resets <date>` (token fallback
 *    when budgetUsd is null), status, masked key with Show / Copy, limit
 *    field whose Save PATCHes /api/admin/llm-proxy/tokens/:id and toasts,
 *    "Open LLM page" link, "OpenRouter activity" external link, Revoke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserLlmProxyCard from '../../client/src/pages/admin/UserLlmProxyCard';
import { ToastProvider } from '../../client/src/context/ToastContext';

const USER_ID = 7;
const TOKEN = 'llmp_testtoken_0123456789abcdef';
const ENDPOINT = 'https://accounts.example.org/proxy';

function renderCard(props: { userId?: number; userName?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <UserLlmProxyCard userId={USER_ID} userName="Pat" {...props} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function enabledPayload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'active',
    tokenId: 42,
    token: TOKEN,
    tokenMasked: 'llmp_test…cdef',
    tokensUsed: 1000,
    tokenLimit: 50000,
    requestCount: 5,
    budgetUsd: 5,
    spentUsd: 1.25,
    spentUsdTotal: 7.5,
    periodResetsAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-06-01T12:00:00Z',
    grantedAt: '2026-05-01T12:00:00Z',
    grantedBy: 1,
    revokedAt: null,
    endpoint: ENDPOINT,
    anthropicEnabled: true,
    anthropicEndpoint: ENDPOINT,
    models: ['league-large', 'league-medium', 'league-small'],
    ...overrides,
  };
}

function disabledPayload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: false,
    status: 'disabled',
    token: null,
    tokenMasked: null,
    endpoint: ENDPOINT,
    anthropicEnabled: true,
    anthropicEndpoint: ENDPOINT,
    models: ['league-large', 'league-medium', 'league-small'],
    ...overrides,
  };
}

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];

/**
 * fetch mock: `status` is served for every GET of the status URL and can be
 * swapped by handlers (so a mutation's refetch sees the new state).
 */
function setFetch(opts: {
  status: () => any;
  onPatch?: (body: any) => { status: number; body: any };
  onPost?: (body: any) => { status: number; body: any };
  onDelete?: () => void;
}) {
  calls = [];
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });

    if (url === `/api/admin/users/${USER_ID}/llm-proxy` && method === 'GET') {
      return json(200, opts.status());
    }
    if (url.startsWith('/api/admin/llm-proxy/tokens/') && method === 'PATCH') {
      const r = opts.onPatch?.(body) ?? { status: 200, body: {} };
      return json(r.status, r.body);
    }
    if (url === `/api/admin/users/${USER_ID}/llm-proxy-token` && method === 'POST') {
      const r = opts.onPost?.(body) ?? { status: 201, body: { token: TOKEN, tokenId: 42 } };
      return json(r.status, r.body);
    }
    if (url === `/api/admin/users/${USER_ID}/llm-proxy-token` && method === 'DELETE') {
      opts.onDelete?.();
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return json(404, { error: `unexpected ${method} ${url}` });
  }) as any;
}

function json(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const originalFetch = globalThis.fetch;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.confirm = vi.fn(() => true);
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Enabled
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — enabled', () => {
  it('shows the dollar meter, usage line with reset date, status, masked key and request count', async () => {
    setFetch({ status: () => enabledPayload() });
    renderCard();

    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('$1.25 of $5.00 this month · resets Nov 1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/5 requests/)).toBeInTheDocument();
    expect(screen.getByText(/\$7\.50 lifetime/)).toBeInTheDocument();
    expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Active$/);
    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent('llmp_test…cdef');
    expect(screen.queryByText(TOKEN)).toBeNull();
    expect(screen.getByTestId('llm-proxy-limit-input')).toHaveValue(5);
    // No setup snippets on the card; they live on the page.
    expect(screen.queryByTestId('llm-proxy-setup-examples')).toBeNull();
  });

  it('falls back to token figures when the token has no dollar budget', async () => {
    setFetch({ status: () => enabledPayload({ budgetUsd: null, spentUsd: 0, periodResetsAt: null }) });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('1,000 / 50,000 tokens');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByTestId('llm-proxy-limit-input')).toHaveValue(null);
    expect(screen.getByText(/legacy token quota/)).toBeInTheDocument();
  });

  it('Show reveals the full key, Hide masks it again, Copy writes it to the clipboard', async () => {
    setFetch({ status: () => enabledPayload() });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-token')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /show key/i }));
    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /hide key/i }));
    expect(screen.getByTestId('llm-proxy-token')).not.toHaveTextContent(TOKEN);

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
    expect(screen.getByRole('button', { name: /copy key/i })).toHaveTextContent('Copied');
  });

  it('links to the admin LLM page and to OpenRouter activity (account-wide, new tab)', async () => {
    setFetch({ status: () => enabledPayload() });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-open-page')).toBeInTheDocument());

    expect(screen.getByTestId('llm-proxy-open-page')).toHaveAttribute('href', `/admin/users/${USER_ID}/llm-proxy`);
    expect(screen.getByTestId('llm-proxy-open-page')).toHaveTextContent('Open LLM page');

    const or = screen.getByTestId('llm-proxy-openrouter-link');
    expect(or).toHaveAttribute('href', 'https://openrouter.ai/activity');
    expect(or).toHaveAttribute('target', '_blank');
    expect(or).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(or).toHaveTextContent(/OpenRouter activity/);
    expect(or).toHaveTextContent(/account-wide/);
  });

  it('Save PATCHes the new monthly limit, toasts, and the refetched value fills the field', async () => {
    let budget = 5;
    setFetch({
      status: () => enabledPayload({ budgetUsd: budget }),
      onPatch: (body) => {
        budget = body.budgetUsd;
        return { status: 200, body: enabledPayload({ budgetUsd: budget }) };
      },
    });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-limit-input')).toBeInTheDocument());

    const input = screen.getByTestId('llm-proxy-limit-input') as HTMLInputElement;
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('step', '0.5');
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled(); // unchanged

    fireEvent.change(input, { target: { value: '10' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(patch!.url).toBe('/api/admin/llm-proxy/tokens/42');
      expect(patch!.body).toEqual({ budgetUsd: 10 });
    });
    await waitFor(() => expect(screen.getByText(/Monthly limit set to \$10\.00/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('of $10.00'));
    expect(screen.getByTestId('llm-proxy-limit-input')).toHaveValue(10);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('rejects an invalid limit client-side and surfaces a server error', async () => {
    setFetch({
      status: () => enabledPayload(),
      onPatch: () => ({ status: 400, body: { error: 'budgetUsd must be a positive number no greater than 1000.' } }),
    });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-limit-input')).toBeInTheDocument());
    const input = screen.getByTestId('llm-proxy-limit-input');

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/between \$0\.01 and \$1000/);
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    await waitFor(() =>
      expect(screen.getAllByText(/budgetUsd must be a positive number/).length).toBeGreaterThan(0),
    );
  });

  it('Revoke confirms, DELETEs the token and re-fetches status', async () => {
    let enabled = true;
    setFetch({
      status: () => (enabled ? enabledPayload() : disabledPayload({ status: 'revoked', revokedAt: '2026-10-18T00:00:00Z' })),
      onDelete: () => {
        enabled = false;
      },
    });
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /revoke access/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /revoke access/i }));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Revoked$/));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
    expect(screen.getByRole('button', { name: /grant access/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Disabled + grant flow
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — disabled and grant', () => {
  it('renders the status pill, Grant access and the OpenRouter link when there is no token', async () => {
    setFetch({ status: () => disabledPayload() });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Disabled$/));
    expect(screen.getByRole('button', { name: /grant access/i })).toBeInTheDocument();
    expect(screen.getByTestId('llm-proxy-openrouter-link')).toHaveAttribute('href', 'https://openrouter.ai/activity');
    expect(screen.queryByTestId('llm-proxy-token')).toBeNull();
    expect(screen.queryByTestId('llm-proxy-open-page')).toBeNull();
  });

  it('shows "Expired" for a lapsed token', async () => {
    setFetch({ status: () => disabledPayload({ status: 'expired', expiresAt: '2026-01-01T00:00:00Z' }) });
    renderCard();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Expired$/));
  });

  it('Grant opens the modal with a $5 default budget and POSTs expiresAt + budgetUsd; status refetches to enabled', async () => {
    let enabled = false;
    setFetch({
      status: () => (enabled ? enabledPayload() : disabledPayload()),
      onPost: () => {
        enabled = true;
        return { status: 201, body: { token: TOKEN, tokenId: 42, budgetUsd: 5 } };
      },
    });
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /grant access/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    const modal = screen.getByText('Grant LLM Proxy Access').closest('div')!.parentElement!;
    const budgetInput = within(modal).getByPlaceholderText('5') as HTMLInputElement;
    expect(budgetInput.value).toBe('5');

    fireEvent.click(within(modal).getByRole('button', { name: /^grant access$/i }));

    await waitFor(() => {
      const post = calls.find((c) => c.method === 'POST');
      expect(post).toBeTruthy();
      expect(post!.body.budgetUsd).toBe(5);
      expect(typeof post!.body.expiresAt).toBe('string');
      expect(new Date(post!.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(post!.body).not.toHaveProperty('tokenLimit');
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /revoke access/i })).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('$1.25 of $5.00');
  });

  it('shows the server error when the grant is rejected', async () => {
    setFetch({
      status: () => disabledPayload(),
      onPost: () => ({ status: 409, body: { error: 'User already has an active token.' } }),
    });
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: /grant access/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /^grant access$/i }).pop()!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already has an active token/));
  });
});
