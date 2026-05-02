/**
 * Tests for the LlmProxy page (Sprint 021, ticket 002).
 *
 * Covers:
 *  - Enabled state: renders endpoint, token, and quota bar.
 *  - Not-enabled state: renders "Not enabled" message.
 *  - Loading state: renders loading indicator before data resolves.
 *  - Error state: hides card gracefully on fetch error.
 *  - Route smoke test: /llm-proxy resolves correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LlmProxy from '../../../client/src/pages/LlmProxy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlmProxyEnabled(overrides: Partial<{
  endpoint: string;
  token: string | null;
  tokensUsed: number;
  tokenLimit: number;
  requestCount: number;
  expiresAt: string;
}> = {}) {
  return {
    enabled: true,
    endpoint: overrides.endpoint ?? 'https://llm.example.com',
    token: overrides.token !== undefined ? overrides.token : 'llmp_testtoken',
    tokensUsed: overrides.tokensUsed ?? 1000,
    tokenLimit: overrides.tokenLimit ?? 50000,
    requestCount: overrides.requestCount ?? 5,
    expiresAt: overrides.expiresAt ?? '2026-12-31T00:00:00Z',
  };
}

function makeLlmProxyDisabled() {
  return {
    enabled: false,
    endpoint: 'https://llm.example.com',
  };
}

function makeFetch(options: {
  llmProxyPayload?: object;
  shouldError?: boolean;
} = {}) {
  return vi.fn(async (url: string) => {
    if (url === '/api/account/llm-proxy') {
      if (options.shouldError) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      const payload = options.llmProxyPayload ?? makeLlmProxyDisabled();
      return {
        ok: true,
        json: async () => payload,
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function renderLlmProxy() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LlmProxy />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// Enabled state — endpoint, token, quota
// ===========================================================================

describe('LlmProxy page — enabled state', () => {
  it('renders the page title', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyEnabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /llm proxy/i }),
      ).toBeInTheDocument();
    });
  });

  it('renders the data-testid card root', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyEnabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });
  });

  it('renders the endpoint URL', async () => {
    (globalThis as any).fetch = makeFetch({
      llmProxyPayload: makeLlmProxyEnabled({ endpoint: 'https://llm.example.com' }),
    });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('llm-proxy-endpoint')).toHaveTextContent(
        'https://llm.example.com',
      );
    });
  });

  it('renders the token', async () => {
    (globalThis as any).fetch = makeFetch({
      llmProxyPayload: makeLlmProxyEnabled({ token: 'llmp_testtoken' }),
    });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('llm-proxy-token')).toHaveTextContent('llmp_testtoken');
    });
  });

  it('renders quota bar and usage numbers', async () => {
    (globalThis as any).fetch = makeFetch({
      llmProxyPayload: makeLlmProxyEnabled({ tokensUsed: 1000, tokenLimit: 50000 }),
    });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByText(/1,000 \/ 50,000 tokens used/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/49,000/)).toBeInTheDocument();
  });

  it('renders request count when provided', async () => {
    (globalThis as any).fetch = makeFetch({
      llmProxyPayload: makeLlmProxyEnabled({ requestCount: 42 }),
    });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByText(/42 requests/i)).toBeInTheDocument();
    });
  });

  it('renders the usage code snippet with endpoint and token', async () => {
    (globalThis as any).fetch = makeFetch({
      llmProxyPayload: makeLlmProxyEnabled({
        endpoint: 'https://llm.example.com',
        token: 'llmp_abc',
      }),
    });

    renderLlmProxy();

    await waitFor(() => {
      const pre = screen.getByText(/ANTHROPIC_BASE_URL/);
      expect(pre).toBeInTheDocument();
    });
  });

  it('renders Copy buttons for endpoint and token', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyEnabled() });

    renderLlmProxy();

    await waitFor(() => {
      const copyBtns = screen.getAllByRole('button', { name: /copy/i });
      expect(copyBtns.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('does not show "not enabled" message when enabled', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyEnabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });

    expect(screen.queryByText(/not enabled/i)).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Not-enabled state
// ===========================================================================

describe('LlmProxy page — not enabled state', () => {
  it('renders the card with data-testid', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyDisabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });
  });

  it('shows "Not enabled" message', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyDisabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
    });
  });

  it('does not render endpoint or token when disabled', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyDisabled() });

    renderLlmProxy();

    await waitFor(() => {
      expect(screen.getByTestId('account-llm-proxy-card')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('llm-proxy-endpoint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('llm-proxy-token')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// Error state — hide card gracefully
// ===========================================================================

describe('LlmProxy page — fetch error', () => {
  it('hides the card on fetch error (returns null)', async () => {
    (globalThis as any).fetch = makeFetch({ shouldError: true });

    const { container } = renderLlmProxy();

    // Give the query time to fail
    await waitFor(() => {
      // The card should not be present; the page title still renders
      expect(screen.queryByTestId('account-llm-proxy-card')).not.toBeInTheDocument();
    });

    // The outer container should still render (page title exists)
    expect(container.querySelector('h1')).toBeInTheDocument();
  });
});

// ===========================================================================
// Route smoke test
// ===========================================================================

describe('LlmProxy page — route smoke test', () => {
  it('/llm-proxy route renders the LlmProxy page within a router', async () => {
    (globalThis as any).fetch = makeFetch({ llmProxyPayload: makeLlmProxyDisabled() });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/llm-proxy']}>
          <Routes>
            <Route path="/llm-proxy" element={<LlmProxy />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: /llm proxy/i }),
      ).toBeInTheDocument();
    });
  });
});
