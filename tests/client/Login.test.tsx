import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../client/src/pages/Login';

// ---- Mock AuthContext ----

const mockLoginWithCredentials = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({ loginWithCredentials: mockLoginWithCredentials }),
}));

// ---- Mock window.location.assign ----

const mockAssign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('location', {
    ...globalThis.location,
    assign: mockAssign,
    search: '',
  });
  // Default: successful login
  mockLoginWithCredentials.mockResolvedValue({ ok: true });
  // Default: fetch (passphrase-signup) not called
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
});

// ---- Helpers ----

function renderLogin(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/login${search}`]}>
      <Login />
    </MemoryRouter>,
  );
}

async function submitForm(username = 'testuser', passphrase = 'testpass') {
  fireEvent.change(screen.getByLabelText(/username/i), { target: { value: username } });
  fireEvent.change(screen.getByLabelText(/passphrase/i), { target: { value: passphrase } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

// ---- Tests ----

describe('Login — next param redirect', () => {
  it('redirects to /account when no next param is present', async () => {
    renderLogin();
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/account');
    });
  });

  it('redirects to next when next is a valid same-origin path', async () => {
    renderLogin('?next=/oauth/authorize?response_type=code%26client_id=abc');
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/oauth/authorize?response_type=code&client_id=abc');
    });
  });

  it('redirects to /account (not evil.com) when next is //evil.com', async () => {
    renderLogin('?next=//evil.com');
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/account');
      expect(mockAssign).not.toHaveBeenCalledWith('//evil.com');
    });
  });

  it('redirects to /account when next is an absolute URL', async () => {
    renderLogin('?next=https://evil.com/steal');
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/account');
    });
  });

  it('redirects to next on successful passphrase-signup when next is safe', async () => {
    // Login fails → falls through to signup path
    mockLoginWithCredentials.mockResolvedValue({ ok: false });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    renderLogin('?next=/account/onboarding');
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/account/onboarding');
    });
  });

  it('redirects to /account on signup success when next is invalid', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    renderLogin('?next=javascript:alert(1)');
    await submitForm();
    await waitFor(() => {
      expect(mockAssign).toHaveBeenCalledWith('/account');
    });
  });
});
