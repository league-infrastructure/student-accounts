/**
 * Tests for UserLlmProxyCard (Sprint 013 T005).
 *
 * Uses a fetch mock to exercise the three render states (disabled,
 * grant-flow plaintext, enabled) and verifies the plaintext-once
 * invariant: the GET endpoint never returns plaintext, so after
 * Dismiss the card must not show it again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import UserLlmProxyCard from '../../client/src/pages/admin/UserLlmProxyCard';

const originalFetch = globalThis.fetch;

type FetchCall = { url: string; init?: RequestInit };
let calls: FetchCall[] = [];

function setFetch(responses: Array<(call: FetchCall) => any>) {
  calls = [];
  let i = 0;
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({ url, init });
    const handler = responses[Math.min(i, responses.length - 1)];
    i++;
    const result = handler({ url, init });
    return result as any;
  }) as any;
}

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  // Silence window.confirm during revoke paths.
  window.confirm = vi.fn(() => true);
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

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — disabled state', () => {
  it('renders the disabled pill + Grant access button when the GET returns { enabled: false }', async () => {
    setFetch([() => jsonResponse(200, { enabled: false })]);
    render(<UserLlmProxyCard userId={7} userName="Pat" />);
    await waitFor(() => {
      expect(screen.getByText(/^disabled$/i)).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: /grant access/i })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Enabled state
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — enabled state', () => {
  it('renders quota and expiry when the GET returns enabled', async () => {
    setFetch([
      () =>
        jsonResponse(200, {
          enabled: true,
          tokenId: 42,
          tokensUsed: 12345,
          tokenLimit: 1_000_000,
          requestCount: 7,
          expiresAt: '2026-06-01T12:00:00Z',
          grantedAt: '2026-05-01T12:00:00Z',
        }),
    ]);
    render(<UserLlmProxyCard userId={7} userName="Pat" />);
    await waitFor(() => {
      expect(screen.getByText(/Revoke access/i)).toBeTruthy();
    });
    // Quota and request count render.
    expect(screen.getByText(/12,345/)).toBeTruthy();
    expect(screen.getByText(/1,000,000 tokens/)).toBeTruthy();
    expect(screen.getByText(/7 requests/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Grant flow
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — grant flow', () => {
  it('shows the plaintext token once after POST, hides on Dismiss', async () => {
    // Sequence: initial GET (disabled), POST grant (plaintext),
    // follow-up GET (enabled without plaintext).
    setFetch([
      () => jsonResponse(200, { enabled: false }),
      () =>
        jsonResponse(201, {
          token: 'llmp_secretvalue',
          tokenId: 1,
          tokenLimit: 1_000_000,
          expiresAt: '2026-06-01T12:00:00Z',
          grantedAt: '2026-05-01T12:00:00Z',
        }),
      () =>
        jsonResponse(200, {
          enabled: true,
          tokenId: 1,
          tokensUsed: 0,
          tokenLimit: 1_000_000,
          requestCount: 0,
          expiresAt: '2026-06-01T12:00:00Z',
          grantedAt: '2026-05-01T12:00:00Z',
        }),
    ]);

    render(<UserLlmProxyCard userId={7} userName="Pat" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /grant access/i })).toBeTruthy();
    });

    // Open the inline form.
    fireEvent.click(screen.getByRole('button', { name: /grant access/i }));
    // Submit grant — the default inputs are fine for this test.
    fireEvent.click(
      screen.getAllByRole('button', { name: /grant access/i }).pop()!,
    );

    // Plaintext appears.
    await waitFor(() => {
      expect(screen.getByTestId('llm-proxy-plaintext')).toBeTruthy();
    });
    expect(screen.getByText('llmp_secretvalue')).toBeTruthy();

    // Dismiss clears it.
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => {
      expect(screen.queryByTestId('llm-proxy-plaintext')).toBeNull();
    });
    expect(screen.queryByText('llmp_secretvalue')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

describe('UserLlmProxyCard — revoke', () => {
  it('DELETEs the token and re-fetches status', async () => {
    setFetch([
      () =>
        jsonResponse(200, {
          enabled: true,
          tokenId: 1,
          tokensUsed: 0,
          tokenLimit: 1_000_000,
          requestCount: 0,
          expiresAt: '2026-06-01T12:00:00Z',
          grantedAt: '2026-05-01T12:00:00Z',
        }),
      () => ({ ok: true, status: 204, json: async () => ({}) }),
      () => jsonResponse(200, { enabled: false }),
    ]);

    render(<UserLlmProxyCard userId={7} userName="Pat" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke access/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /revoke access/i }));

    await waitFor(() => {
      expect(screen.getByText(/^disabled$/i)).toBeTruthy();
    });
    const methods = calls.map((c) => (c.init?.method ?? 'GET').toUpperCase());
    expect(methods).toContain('DELETE');
  });
});
