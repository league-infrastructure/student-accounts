/**
 * Tests for the Login page — invitation-URL handling (Sprint 028 ticket 014).
 *
 * Covers:
 *  - When ?passphrase= is present and /api/auth/me returns 401:
 *      → navigate to /signup?passphrase=<value>
 *  - When ?passphrase= is present and /api/auth/me returns 200 (already logged in):
 *      → navigate to /account
 *  - When ?passphrase= is present and /api/auth/me returns 200 with a valid ?next= param:
 *      → navigate to the ?next= destination
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Login from '../../../client/src/pages/Login';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock useAuth — the Login page only uses loginWithCredentials, but we need
// the hook to exist.
vi.mock('../../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
    loginWithCredentials: vi.fn(async () => ({ ok: false, error: 'bad creds' })),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLogin(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Login page — rendering', () => {
  it('renders a "Sign up" link to /signup', () => {
    renderLogin();

    const link = screen.getByRole('link', { name: /sign up/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/signup');
  });
});

describe('Login page — invitation URL (?passphrase=)', () => {
  it('redirects to /signup?passphrase=<value> when /api/auth/me returns 401', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderLogin('?passphrase=mypassphrase');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/signup?passphrase=mypassphrase',
        { replace: true },
      );
    });
  });

  it('redirects to /account when /api/auth/me returns 200 (already logged in)', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ id: 1 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderLogin('?passphrase=mypassphrase');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/account', { replace: true });
    });
  });

  it('respects a safe ?next= param when already logged in', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ id: 1 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderLogin('?passphrase=mypassphrase&next=/dashboard');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true });
    });
  });

  it('falls back to /account when ?next= is unsafe (open-redirect attempt)', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        return { ok: true, status: 200, json: async () => ({ id: 1 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderLogin('?passphrase=mypassphrase&next=//evil.com');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/account', { replace: true });
    });
  });

  it('does NOT call /api/auth/me when no ?passphrase= param is present', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    }));
    (globalThis as any).fetch = fetchMock;

    renderLogin(); // no passphrase

    // Wait a tick for any effects to run
    await new Promise((r) => setTimeout(r, 50));

    const meCalls = fetchMock.mock.calls.filter(([url]: [string]) => url === '/api/auth/me');
    expect(meCalls).toHaveLength(0);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does NOT navigate on network error — shows the login form normally', async () => {
    (globalThis as any).fetch = vi.fn(async (url: string) => {
      if (url === '/api/auth/me') {
        throw new Error('Network failure');
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    renderLogin('?passphrase=mypassphrase');

    // Wait a tick
    await new Promise((r) => setTimeout(r, 50));

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
