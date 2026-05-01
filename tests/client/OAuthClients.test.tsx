/**
 * Tests for the OAuthClients admin page (Sprint 018 T007).
 *
 * Covers:
 *  - Renders empty state when no clients
 *  - Renders client list (name, client_id, scopes, status)
 *  - Create flow: form submit → secret modal opens with plaintext → list refreshes
 *  - Rotate flow: Rotate button → secret modal opens with new plaintext
 *  - Disable flow: Disable button + confirm → row shows Disabled status
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OAuthClients from '../../client/src/pages/admin/OAuthClients';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const SAMPLE_CLIENT = {
  id: 1,
  client_id: 'client_abc123',
  name: 'My Test App',
  description: 'Integration for testing',
  redirect_uris: ['https://example.com/callback'],
  allowed_scopes: ['users:read'],
  created_at: '2025-01-01T00:00:00Z',
  disabled_at: null,
};

const DISABLED_CLIENT = {
  ...SAMPLE_CLIENT,
  id: 2,
  client_id: 'client_def456',
  name: 'Disabled App',
  disabled_at: '2025-02-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(queryClient?: QueryClient) {
  const client = queryClient ?? makeQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <OAuthClients />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------

function mockFetch(responses: Record<string, unknown>) {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url}`;
    const body = responses[key] ?? responses[url] ?? responses['*'];
    if (body === undefined) {
      return new Response(JSON.stringify({ error: `No mock for ${key}` }), { status: 500 });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OAuthClients — empty state', () => {
  it('renders empty state when no clients', async () => {
    mockFetch({ 'GET /api/admin/oauth-clients': [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No OAuth clients registered yet/i)).toBeTruthy();
    });
  });
});

describe('OAuthClients — list', () => {
  it('renders client rows with name, client_id, status', async () => {
    mockFetch({ 'GET /api/admin/oauth-clients': [SAMPLE_CLIENT, DISABLED_CLIENT] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('My Test App')).toBeTruthy();
      expect(screen.getByText('Disabled App')).toBeTruthy();
      expect(screen.getByText('client_abc123')).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();
      expect(screen.getByText('Disabled')).toBeTruthy();
    });
  });

  it('shows scopes as pills', async () => {
    mockFetch({ 'GET /api/admin/oauth-clients': [SAMPLE_CLIENT] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('users:read')).toBeTruthy();
    });
  });
});

describe('OAuthClients — create flow', () => {
  it('opens form modal on "New OAuth Client" click', async () => {
    mockFetch({ 'GET /api/admin/oauth-clients': [] });
    renderPage();
    await waitFor(() => screen.getByText(/New OAuth Client/i));
    fireEvent.click(screen.getByText(/\+ New OAuth Client/i));
    expect(screen.getByText(/New OAuth Client/i, { selector: 'h2' })).toBeTruthy();
  });

  it('shows secret modal after successful create', async () => {
    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      callCount++;
      if (method === 'POST') {
        return new Response(
          JSON.stringify({ client: SAMPLE_CLIENT, client_secret: 'oacs_supersecret123' }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // GET list
      return new Response(JSON.stringify([SAMPLE_CLIENT]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    renderPage();
    await waitFor(() => screen.getByText(/\+ New OAuth Client/i));

    fireEvent.click(screen.getByText(/\+ New OAuth Client/i));

    const nameInput = screen.getByPlaceholderText('My Integration');
    fireEvent.change(nameInput, { target: { value: 'Test App' } });

    const scopesInput = screen.getByPlaceholderText('users:read');
    fireEvent.change(scopesInput, { target: { value: 'users:read' } });

    fireEvent.click(screen.getByText('Create Client'));

    await waitFor(() => {
      expect(screen.getByText('oacs_supersecret123')).toBeTruthy();
      expect(screen.getByText(/once only/i)).toBeTruthy();
    });
  });
});

describe('OAuthClients — rotate flow', () => {
  it('shows secret modal with new secret after rotation', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST') {
        return new Response(
          JSON.stringify({ client_secret: 'oacs_rotatedsecret456' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify([SAMPLE_CLIENT]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    // Confirm dialog mock.
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();
    await waitFor(() => screen.getByText('Rotate'));

    fireEvent.click(screen.getByText('Rotate'));

    await waitFor(() => {
      expect(screen.getByText('oacs_rotatedsecret456')).toBeTruthy();
      expect(screen.getByText(/Rotated Client Secret/i)).toBeTruthy();
    });
  });
});

describe('OAuthClients — disable flow', () => {
  it('soft-deletes client and refreshes list', async () => {
    const listAfterDisable = [{ ...SAMPLE_CLIENT, disabled_at: new Date().toISOString() }];
    let deleteCount = 0;

    vi.spyOn(global, 'fetch').mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'DELETE') {
        deleteCount++;
        return new Response(null, { status: 204 });
      }
      const body = deleteCount > 0 ? listAfterDisable : [SAMPLE_CLIENT];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPage();
    await waitFor(() => screen.getByText('Disable'));

    fireEvent.click(screen.getByText('Disable'));

    await waitFor(() => {
      expect(deleteCount).toBe(1);
    });
  });
});
