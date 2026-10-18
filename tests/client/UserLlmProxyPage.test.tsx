/**
 * Tests for the admin UserLlmProxyPage at /admin/users/:id/llm-proxy
 * (sprint 003, ticket 005).
 *
 *  - Header with the student's name; figures, masked key, endpoint.
 *  - The shared setup examples rendered with THIS student's token and
 *    endpoint; Claude Code tab gated on anthropicEnabled.
 *  - "Recent requests" table rows and empty state.
 *  - Not-enabled state: no examples, link back to the user page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserLlmProxyPage from '../../client/src/pages/admin/UserLlmProxyPage';
import { ToastProvider } from '../../client/src/context/ToastContext';
import { EXAMPLES } from '../../client/src/components/llm-examples';

const USER_ID = 7;
const TOKEN = 'llmp_testtoken_0123456789abcdef';
const ENDPOINT = 'https://accounts.example.org/proxy';
const MODELS = ['league-large', 'league-medium', 'league-small'];

const USER = { id: USER_ID, email: 'pat.lee@jointheleague.org', displayName: null, role: 'student' };

function enabledPayload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    status: 'active',
    tokenId: 42,
    token: TOKEN,
    tokenMasked: 'llmp_test…cdef',
    tokensUsed: 1000,
    tokenLimit: 50000,
    requestCount: 2,
    budgetUsd: 5,
    spentUsd: 1.25,
    spentUsdTotal: 1.25,
    periodResetsAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-06-01T12:00:00Z',
    grantedAt: '2026-05-01T12:00:00Z',
    revokedAt: null,
    endpoint: ENDPOINT,
    anthropicEnabled: true,
    anthropicEndpoint: ENDPOINT,
    models: MODELS,
    ...overrides,
  };
}

const REQUESTS = [
  {
    id: 2,
    ts: '2026-10-18T10:05:00.000Z',
    protocol: 'anthropic',
    modelRequested: 'claude-sonnet-4-5',
    modelSent: 'anthropic/claude-sonnet-4.5',
    inputTokens: 1200,
    outputTokens: 340,
    costUsd: 0.0123,
    status: 200,
  },
  {
    id: 1,
    ts: '2026-10-18T10:00:00.000Z',
    protocol: 'openai',
    modelRequested: 'league-small',
    modelSent: 'deepseek/deepseek-v4-flash',
    inputTokens: 50,
    outputTokens: 10,
    costUsd: 0.0003,
    status: 429,
  },
];

function setFetch(opts: { status?: any; requests?: any[]; requestsStatus?: number } = {}) {
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url === `/api/admin/users/${USER_ID}`) return json(200, USER);
    if (url === `/api/admin/users/${USER_ID}/llm-proxy`) return json(200, opts.status ?? enabledPayload());
    if (url === `/api/admin/users/${USER_ID}/llm-proxy/requests?limit=50`) {
      return json(opts.requestsStatus ?? 200, opts.requests ?? REQUESTS);
    }
    return json(404, { error: `unexpected ${url}` });
  }) as any;
}

function json(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function renderPage(path = `/admin/users/${USER_ID}/llm-proxy`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/admin/users/:id/llm-proxy" element={<UserLlmProxyPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const originalFetch = globalThis.fetch;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('UserLlmProxyPage — header and figures', () => {
  it('shows the student name, figures, masked key with Show/Copy, endpoint and a back link', async () => {
    setFetch();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('llm-proxy-page-title')).toHaveTextContent('LLM Proxy — Pat Lee'));
    expect(screen.getByTestId('llm-proxy-back-link')).toHaveAttribute('href', `/users/${USER_ID}`);

    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('$1.25 of $5.00 this month · resets Nov 1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Active$/);
    expect(screen.getByTestId('llm-proxy-endpoint')).toHaveTextContent(ENDPOINT);
    expect(screen.getByTestId('llm-proxy-limit-input')).toHaveValue(5);

    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent('llmp_test…cdef');
    fireEvent.click(screen.getByRole('button', { name: /show key/i }));
    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));

    expect(screen.getByTestId('llm-proxy-openrouter-link')).toHaveAttribute('href', 'https://openrouter.ai/activity');
  });
});

describe('UserLlmProxyPage — setup examples', () => {
  it("renders every example with the student's token and endpoint", async () => {
    setFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-setup-examples')).toBeInTheDocument());

    expect(screen.getAllByRole('tab')).toHaveLength(EXAMPLES.length);
    for (const entry of EXAMPLES) {
      fireEvent.click(screen.getByTestId(`llm-example-tab-${entry.id}`));
      const body = screen.getByTestId(`llm-example-body-${entry.id}`);
      expect(body.textContent).toContain(TOKEN);
      expect(body.textContent).toContain(ENDPOINT);
    }
    fireEvent.click(screen.getByTestId('llm-example-tab-claude-code'));
    expect(screen.getByTestId('llm-example-body-claude-code')).toHaveTextContent(`ANTHROPIC_BASE_URL="${ENDPOINT}"`);
    for (const m of MODELS) expect(screen.getAllByText(m).length).toBeGreaterThan(0);
  });

  it('hides the Claude Code tab when anthropicEnabled is false', async () => {
    setFetch({ status: enabledPayload({ anthropicEnabled: false, anthropicEndpoint: null }) });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-setup-examples')).toBeInTheDocument());
    expect(screen.getAllByRole('tab')).toHaveLength(EXAMPLES.length - 1);
    expect(screen.queryByRole('tab', { name: /claude code/i })).toBeNull();
  });
});

describe('UserLlmProxyPage — recent requests', () => {
  it('renders one row per request, newest first, with model, tokens, cost and status', async () => {
    setFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-requests-table')).toBeInTheDocument());

    const rows = screen.getAllByTestId('llm-proxy-request-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('anthropic/claude-sonnet-4.5')).toBeInTheDocument();
    expect(within(rows[0]).getByText('anthropic')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1,200')).toBeInTheDocument();
    expect(within(rows[0]).getByText('340')).toBeInTheDocument();
    expect(within(rows[0]).getByText('$0.0123')).toBeInTheDocument();
    expect(within(rows[0]).getByText('200')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/asked for claude-sonnet-4-5/)).toBeInTheDocument();

    expect(within(rows[1]).getByText('deepseek/deepseek-v4-flash')).toBeInTheDocument();
    expect(within(rows[1]).getByText('$0.0003')).toBeInTheDocument();
    expect(within(rows[1]).getByText('429')).toBeInTheDocument();
    expect(screen.getByText(/Last 2 requests, newest first/)).toBeInTheDocument();
    expect(screen.queryByTestId('llm-proxy-requests-empty')).toBeNull();
  });

  it('shows the empty state when the log has no rows', async () => {
    setFetch({ requests: [] });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-requests-empty')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-requests-empty')).toHaveTextContent(/No requests yet/);
    expect(screen.queryByTestId('llm-proxy-requests-table')).toBeNull();
  });

  it('reports a request-log fetch failure without hiding the rest of the page', async () => {
    setFetch({ requestsStatus: 500, requests: {} as any });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Could not load requests/)).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument();
  });
});

describe('UserLlmProxyPage — other states', () => {
  it('without an active token: status, link back to the user page, no examples; log still shown', async () => {
    setFetch({
      status: {
        enabled: false,
        status: 'revoked',
        token: null,
        tokenMasked: null,
        revokedAt: '2026-10-01T00:00:00Z',
        endpoint: ENDPOINT,
        anthropicEnabled: true,
        anthropicEndpoint: ENDPOINT,
        models: MODELS,
      },
      requests: [],
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-not-enabled')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-not-enabled')).toHaveTextContent(/Revoked/);
    expect(within(screen.getByTestId('llm-proxy-not-enabled')).getByRole('link', { name: /user's page/i })).toHaveAttribute(
      'href',
      `/users/${USER_ID}`,
    );
    expect(screen.queryByTestId('llm-proxy-setup-examples')).toBeNull();
    expect(screen.queryByTestId('llm-proxy-token')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-requests-empty')).toBeInTheDocument());
  });

  it('shows a loading indicator before data resolves', () => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as any;
    renderPage();
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
  });

  it('rejects a non-numeric id', () => {
    setFetch();
    renderPage('/admin/users/abc/llm-proxy');
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid user id/);
  });
});
