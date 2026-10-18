/**
 * Tests for the /llm-proxy page (sprint 003, ticket 004; replaces the
 * Sprint 021 ticket 002 page test).
 *
 *  - Header: masked key with Show/Copy, endpoint with Copy, dollar meter,
 *    reset date, request count, status.
 *  - Setup examples below: every tab carries the token and endpoint;
 *    Claude Code tab gated on anthropicEnabled.
 *  - Not-enabled, loading, error and route smoke cases.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LlmProxy from '../../client/src/pages/LlmProxy';
import { EXAMPLES } from '../../client/src/components/llm-examples';

const ENDPOINT = 'https://accounts.example.org/proxy';
const TOKEN = 'llmp_testtoken_0123456789abcdef';
const MODELS = ['league-large', 'league-medium', 'league-small'];

function enabledPayload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    endpoint: ENDPOINT,
    token: TOKEN,
    tokensUsed: 1000,
    tokenLimit: 50000,
    requestCount: 5,
    budgetUsd: 5,
    spentUsd: 1.25,
    spentUsdTotal: 7.5,
    periodResetsAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-12-31T00:00:00Z',
    grantedAt: '2026-10-01T00:00:00Z',
    models: MODELS,
    anthropicEnabled: true,
    anthropicEndpoint: ENDPOINT,
    ...overrides,
  };
}

function makeFetch(options: { payload?: object; shouldError?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (url === '/api/account/llm-proxy') {
      if (options.shouldError) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => options.payload ?? { enabled: false, endpoint: ENDPOINT } };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LlmProxy />
      </MemoryRouter>
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

describe('LlmProxy page — header', () => {
  it('renders the title, masked key, endpoint, dollar meter, reset date, request count and status', async () => {
    (globalThis as any).fetch = makeFetch({ payload: enabledPayload() });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('llm-proxy-token')).toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: /llm proxy/i })).toBeInTheDocument();

    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent('llmp_test…cdef');
    expect(screen.getByTestId('llm-proxy-endpoint')).toHaveTextContent(ENDPOINT);
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent(/^\$1\.25 of \$5\.00 this month/);
    expect(screen.getByTestId('llm-proxy-resets')).toHaveTextContent(/Nov 1/);
    expect(screen.getByText(/5 requests/)).toBeInTheDocument();
    expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/^Active/);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('Show reveals the full key and Copy writes it; Copy endpoint writes the endpoint', async () => {
    (globalThis as any).fetch = makeFetch({ payload: enabledPayload() });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-token')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /show key/i }));
    expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent(TOKEN);
    fireEvent.click(screen.getByRole('button', { name: /hide key/i }));
    expect(screen.getByTestId('llm-proxy-token')).not.toHaveTextContent(TOKEN);

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
    fireEvent.click(screen.getByRole('button', { name: /copy endpoint/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ENDPOINT));
  });

  it('falls back to token figures and hides the reset row for a legacy token', async () => {
    (globalThis as any).fetch = makeFetch({
      payload: enabledPayload({ budgetUsd: null, spentUsd: 0, periodResetsAt: null }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('1,000 / 50,000 tokens');
    expect(screen.queryByTestId('llm-proxy-resets')).toBeNull();
  });
});

describe('LlmProxy page — setup examples', () => {
  it('renders all seven examples, each with the token and endpoint, when Anthropic is enabled', async () => {
    (globalThis as any).fetch = makeFetch({ payload: enabledPayload() });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-setup-examples')).toBeInTheDocument());

    expect(screen.getAllByRole('tab')).toHaveLength(7);
    for (const entry of EXAMPLES) {
      fireEvent.click(screen.getByTestId(`llm-example-tab-${entry.id}`));
      const body = screen.getByTestId(`llm-example-body-${entry.id}`);
      expect(body.textContent).toContain(TOKEN);
      expect(body.textContent).toContain(ENDPOINT);
    }
    // The Claude Code tab uses the Anthropic base from the payload.
    fireEvent.click(screen.getByTestId('llm-example-tab-claude-code'));
    expect(screen.getByTestId('llm-example-body-claude-code')).toHaveTextContent(
      `ANTHROPIC_BASE_URL="${ENDPOINT}"`,
    );
  });

  it('hides the Claude Code tab when anthropicEnabled is false', async () => {
    (globalThis as any).fetch = makeFetch({
      payload: enabledPayload({ anthropicEnabled: false, anthropicEndpoint: null }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-setup-examples')).toBeInTheDocument());
    expect(screen.getAllByRole('tab')).toHaveLength(6);
    expect(screen.queryByRole('tab', { name: /claude code/i })).toBeNull();
  });

  it('lists the model tiers from the payload', async () => {
    (globalThis as any).fetch = makeFetch({ payload: enabledPayload() });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-setup-examples')).toBeInTheDocument());
    for (const m of MODELS) expect(screen.getAllByText(m).length).toBeGreaterThan(0);
  });
});

describe('LlmProxy page — other states', () => {
  it('shows "Not enabled. Ask an instructor." and no examples when disabled', async () => {
    (globalThis as any).fetch = makeFetch();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('llm-proxy-not-enabled')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-not-enabled')).toHaveTextContent(/Ask an instructor/);
    expect(screen.queryByTestId('llm-proxy-token')).toBeNull();
    expect(screen.queryByTestId('llm-proxy-setup-examples')).toBeNull();
  });

  it('shows a loading indicator before data resolves', () => {
    (globalThis as any).fetch = vi.fn(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('hides the body but keeps the title on fetch error', async () => {
    (globalThis as any).fetch = makeFetch({ shouldError: true });
    const { container } = renderPage();
    await waitFor(() => expect(screen.queryByTestId('account-llm-proxy-card')).toBeNull());
    expect(container.querySelector('h1')).toBeInTheDocument();
  });

  it('/llm-proxy route renders the page', async () => {
    (globalThis as any).fetch = makeFetch({ payload: enabledPayload() });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/llm-proxy']}>
          <Routes>
            <Route path="/llm-proxy" element={<LlmProxy />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: /llm proxy/i })).toBeInTheDocument(),
    );
  });
});
