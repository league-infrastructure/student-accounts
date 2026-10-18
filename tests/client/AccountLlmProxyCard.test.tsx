/**
 * Tests for AccountLlmProxyCard (sprint 003, ticket 004; first written in
 * Sprint 013 T006).
 *
 * The card is deliberately tight: figures, status, masked key with Copy,
 * one "Set up and details" button. No code blocks. Dollar figures when the
 * payload has a budget, token figures otherwise, "Not enabled. Ask an
 * instructor." without a token.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import AccountLlmProxyCard from '../../client/src/pages/account/AccountLlmProxyCard';

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const TOKEN = 'llmp_testtoken_0123456789abcdef';

function enabledPayload(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    endpoint: 'https://accounts.example.org/proxy',
    token: TOKEN,
    tokensUsed: 2_500,
    tokenLimit: 10_000,
    requestCount: 3,
    budgetUsd: 5,
    spentUsd: 0.75,
    spentUsdTotal: 0.75,
    periodResetsAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2027-07-01T12:00:00Z',
    grantedAt: '2026-06-01T12:00:00Z',
    models: ['league-large', 'league-medium', 'league-small'],
    anthropicEnabled: true,
    anthropicEndpoint: 'https://accounts.example.org/proxy',
    ...overrides,
  };
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('AccountLlmProxyCard — not enabled', () => {
  it('says "Not enabled. Ask an instructor." when enabled:false', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { enabled: false, endpoint: 'https://accounts.example.org/proxy' }),
    ) as any;

    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-not-enabled')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-not-enabled')).toHaveTextContent(
      /Not enabled\.\s*Ask an instructor\./,
    );
    expect(screen.queryByTestId('llm-proxy-token')).toBeNull();
    expect(screen.queryByRole('link', { name: /set up and details/i })).toBeNull();
  });

  it('says "Not enabled" when enabled but the server has no plaintext token', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, enabledPayload({ token: null }))) as any;
    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-not-enabled')).toBeInTheDocument());
  });

  it('hides itself on a fetch error', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(500, {})) as any;
    const { container } = renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.queryByTestId('account-llm-proxy-card')).toBeNull());
    expect(container.textContent).toBe('');
  });
});

describe('AccountLlmProxyCard — enabled', () => {
  it('shows dollar figures with the reset date, status, masked key and the one button; no code blocks', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, enabledPayload())) as any;

    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());

    const usage = screen.getByTestId('llm-proxy-usage');
    expect(usage).toHaveTextContent(/^\$0\.75 of \$5\.00 this month · resets /);
    expect(usage).toHaveTextContent(/Nov 1/);
    expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/active/i);
    expect(screen.getByText(/3 requests/)).toBeInTheDocument();

    // Masked key: prefix and tail visible, middle hidden, never the full token.
    const key = screen.getByTestId('llm-proxy-token');
    expect(key).toHaveTextContent('llmp_test…cdef');
    expect(key.textContent).not.toBe(TOKEN);

    const link = screen.getByRole('link', { name: /set up and details/i });
    expect(link).toHaveAttribute('href', '/llm-proxy');

    const card = screen.getByTestId('account-llm-proxy-card');
    expect(card.querySelector('pre')).toBeNull();
    expect(card.textContent).not.toMatch(/curl|apiBase|ANTHROPIC_/);
    // Exactly one Copy and one navigation control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('falls back to token figures when budgetUsd is null', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, enabledPayload({ budgetUsd: null, spentUsd: 0, periodResetsAt: null })),
    ) as any;

    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-usage')).toBeInTheDocument());
    expect(screen.getByTestId('llm-proxy-usage')).toHaveTextContent('2,500 / 10,000 tokens');
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('shows Expired when expiresAt is in the past', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, enabledPayload({ expiresAt: '2020-01-01T00:00:00Z' })),
    ) as any;
    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-status')).toHaveTextContent(/expired/i));
  });

  it('Copy puts the full plaintext token on the clipboard', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, enabledPayload())) as any;
    renderWithClient(<AccountLlmProxyCard />);
    await waitFor(() => expect(screen.getByTestId('llm-proxy-token')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /copy key/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TOKEN));
  });
});
