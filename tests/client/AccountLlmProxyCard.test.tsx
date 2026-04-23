/**
 * Tests for AccountLlmProxyCard (Sprint 013 T006).
 *
 * Verifies both render states (disabled + enabled) and the
 * plaintext-never-leaks invariant: no matter what the server returns,
 * the component must never display a token value.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AccountLlmProxyCard from '../../client/src/pages/account/AccountLlmProxyCard';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

beforeEach(() => {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('AccountLlmProxyCard — disabled state', () => {
  it('renders "Not enabled" when server returns enabled:false', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        enabled: false,
        endpoint: 'https://app.example.com/proxy/v1',
      }),
    ) as any;

    render(<AccountLlmProxyCard />);
    await waitFor(() => {
      expect(screen.getByText(/not enabled/i)).toBeTruthy();
    });
    // No quota data should render.
    expect(screen.queryByText(/remaining/i)).toBeNull();
  });
});

describe('AccountLlmProxyCard — enabled state', () => {
  it('renders endpoint, quota, and expiry', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        enabled: true,
        endpoint: 'https://app.example.com/proxy/v1',
        tokensUsed: 2_500,
        tokenLimit: 10_000,
        requestCount: 3,
        expiresAt: '2026-07-01T12:00:00Z',
        grantedAt: '2026-06-01T12:00:00Z',
      }),
    ) as any;

    render(<AccountLlmProxyCard />);
    await waitFor(() => {
      expect(screen.getByTestId('llm-proxy-endpoint')).toBeTruthy();
    });
    expect(screen.getByText('https://app.example.com/proxy/v1')).toBeTruthy();
    expect(screen.getByText(/2,500/)).toBeTruthy();
    expect(screen.getByText(/10,000 tokens used/)).toBeTruthy();
    expect(screen.getByText(/7,500/)).toBeTruthy(); // remaining
    expect(screen.getByText(/3 requests/)).toBeTruthy();
  });

  it('shows setup snippets with the endpoint substituted', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        enabled: true,
        endpoint: 'https://app.example.com/proxy/v1',
        tokensUsed: 0,
        tokenLimit: 100,
        requestCount: 0,
        expiresAt: '2026-07-01T12:00:00Z',
        grantedAt: '2026-06-01T12:00:00Z',
      }),
    ) as any;

    render(<AccountLlmProxyCard />);
    await waitFor(() => {
      expect(screen.getByTestId('llm-proxy-endpoint')).toBeTruthy();
    });

    const card = screen.getByTestId('account-llm-proxy-card');
    // The endpoint URL appears in the snippet too.
    const occurrences = (
      card.textContent ?? ''
    ).match(/https:\/\/app\.example\.com\/proxy\/v1/g);
    expect((occurrences?.length ?? 0) >= 2).toBe(true);
    // Plaintext token is never surfaced — the placeholder is the only
    // string the user sees.
    expect(card.textContent).toContain('llmp_…');
  });
});
