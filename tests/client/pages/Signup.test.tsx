/**
 * Tests for the Signup page (Sprint 028 ticket 014).
 *
 * Covers:
 *  - Form renders all four fields (Username, Password, Full name, Email).
 *  - "Already have an account? Sign in" link is present and points to /login.
 *  - Successful POST navigates to /account.
 *  - Failed POST surfaces the server error message inline.
 *  - 409 response surfaces a "username already taken" message.
 *  - Passphrase from ?passphrase= is included in the POST body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Signup from '../../../client/src/pages/Signup';

// ---------------------------------------------------------------------------
// navigate mock
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render Signup inside a MemoryRouter so useSearchParams works.
 * Pass `search` to pre-populate the URL query string, e.g. "?passphrase=abc".
 */
function renderSignup(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/signup${search}`]}>
      <Routes>
        <Route path="/signup" element={<Signup />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Fill in all five form fields and submit. */
async function fillAndSubmit({
  passphrase = 'testphrase',
  username = 'alice',
  password = 'secret123',
  displayName = 'Alice Smith',
  email = 'alice@example.com',
}: {
  passphrase?: string;
  username?: string;
  password?: string;
  displayName?: string;
  email?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: passphrase } });
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: displayName } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /create account/i }));
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

describe('Signup page — rendering', () => {
  it('renders all five form fields including Passphrase', () => {
    renderSignup();

    expect(screen.getByLabelText(/passphrase/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('renders the passphrase field empty by default (no URL param)', () => {
    renderSignup();

    expect(screen.getByLabelText(/passphrase/i)).toHaveValue('');
  });

  it('pre-fills the passphrase field from the ?passphrase= URL param', () => {
    renderSignup('?passphrase=myinstructorphrase');

    expect(screen.getByLabelText(/passphrase/i)).toHaveValue('myinstructorphrase');
  });

  it('allows the user to edit the pre-filled passphrase value', () => {
    renderSignup('?passphrase=original');

    const field = screen.getByLabelText(/passphrase/i);
    fireEvent.change(field, { target: { value: 'edited' } });
    expect(field).toHaveValue('edited');
  });

  it('renders a "Sign in" link to /login', () => {
    renderSignup();

    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/login');
  });

  it('renders the "Create account" submit button', () => {
    renderSignup();

    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });
});

describe('Signup page — form submission', () => {
  it('navigates to /account on successful POST', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    renderSignup();
    await fillAndSubmit();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/account');
    });
  });

  it('POSTs to /api/auth/passphrase-signup with the passphrase from the URL', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    (globalThis as any).fetch = fetchMock;

    renderSignup('?passphrase=testphrase');
    await fillAndSubmit({ username: 'bob', password: 'pass', displayName: 'Bob', email: 'bob@example.com' });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/passphrase-signup',
        expect.objectContaining({
          method: 'POST',
        }),
      );

      const callArgs = fetchMock.mock.calls[0];
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.passphrase).toBe('testphrase');
      expect(body.username).toBe('bob');
      expect(body.password).toBe('pass');
      expect(body.displayName).toBe('Bob');
      expect(body.email).toBe('bob@example.com');
    });
  });

  it('shows a server error message on failed POST (non-409)', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Passphrase is invalid or expired' }),
    }));

    renderSignup('?passphrase=badphrase');
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Passphrase is invalid or expired');
    });

    // No navigation should have happened
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows "username already taken" message on 409 response', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Username taken' }),
    }));

    renderSignup('?passphrase=testphrase');
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('already taken');
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows a generic error when POST fails with no server message', async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    renderSignup('?passphrase=testphrase');
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('shows a network error message when fetch throws', async () => {
    (globalThis as any).fetch = vi.fn(async () => {
      throw new Error('Network failure');
    });

    renderSignup('?passphrase=testphrase');
    await fillAndSubmit();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });

  it('disables the button while submitting', async () => {
    let resolveSignup!: (v: unknown) => void;
    const pendingPromise = new Promise((resolve) => {
      resolveSignup = resolve;
    });

    (globalThis as any).fetch = vi.fn(() => pendingPromise);

    renderSignup('?passphrase=testphrase');
    await fillAndSubmit();

    // Button should be disabled immediately after submit
    expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();

    // Resolve the fetch so the component cleans up
    resolveSignup({ ok: true, status: 200, json: async () => ({}) });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/account');
    });
  });

  it('POSTs whatever the user typed in the passphrase field', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    (globalThis as any).fetch = fetchMock;

    // No passphrase in URL; user types one manually
    renderSignup();
    await fillAndSubmit({ passphrase: 'manualphrase' });

    await waitFor(() => {
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.passphrase).toBe('manualphrase');
    });
  });
});
