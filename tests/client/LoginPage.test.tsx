import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../client/src/pages/Login';

// ---- Mock AuthContext ----

const mockLoginWithCredentials = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    loginWithCredentials: mockLoginWithCredentials,
    refresh: vi.fn(),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

// ---- Mock window.location.assign ----

const mockLocationAssign = vi.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, assign: mockLocationAssign },
  writable: true,
});

beforeEach(() => {
  mockLoginWithCredentials.mockReset();
  mockLocationAssign.mockReset();
});

function renderLogin(initialEntry: string = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Login />
    </MemoryRouter>,
  );
}

describe('Login page', () => {
  it('renders one Username field and one Passphrase field, both visible', () => {
    renderLogin();
    const username = screen.getByLabelText(/username/i);
    const passphrase = screen.getByLabelText(/passphrase/i);
    expect(username).toBeInTheDocument();
    expect(passphrase).toBeInTheDocument();
    // Passphrase must NOT be type="password" — students need to verify
    // what they typed against what's in Slack.
    expect(passphrase).toHaveAttribute('type', 'text');
  });

  it('always renders the Google, GitHub, and Pike 13 OAuth buttons', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute(
      'href',
      '/api/auth/google',
    );
    expect(screen.getByRole('link', { name: /sign in with github/i })).toHaveAttribute(
      'href',
      '/api/auth/github',
    );
    expect(screen.getByRole('link', { name: /sign in with pike 13/i })).toHaveAttribute(
      'href',
      '/api/auth/pike13',
    );
  });

  it('does NOT render a separate signup form / disclosure', () => {
    renderLogin();
    // The single form is the only form. There should be exactly one
    // submit button. (OAuth links are <a>, not buttons.)
    const submits = screen.getAllByRole('button', { name: /sign in/i });
    expect(submits).toHaveLength(1);
    // No "Sign up" submit button or expandable disclosure.
    expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument();
    expect(
      screen.queryByText(/new student\? sign up with a class passphrase/i),
    ).not.toBeInTheDocument();
  });

  it('successful login redirects to /account', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/passphrase/i), 'purple-cactus-river');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('alice', 'purple-cactus-river'),
    );
    await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith('/account'));
  });

  it('falls through to signup when login returns 401, and redirects on signup success', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 42, username: 'bob' }),
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), 'bob');
    await userEvent.type(screen.getByLabelText(/passphrase/i), 'orange-pencil-cloud');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/auth/passphrase-signup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'bob', passphrase: 'orange-pencil-cloud' }),
        }),
      ),
    );
    await waitFor(() => expect(mockLocationAssign).toHaveBeenCalledWith('/account'));
  });

  it('shows a generic error when both login and signup fail', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid or expired passphrase' }),
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), 'unknown');
    await userEvent.type(screen.getByLabelText(/passphrase/i), 'bad-words-here');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid username or passphrase/i);
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it('shows a username-taken error when signup returns 409', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid' });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'That username is already taken' }),
    });

    renderLogin();
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/passphrase/i), 'pen-paper-river');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/username is already taken/i);
    });
  });

  it('shows the permanently-denied message when ?error=permanently_denied is present', () => {
    renderLogin('/login?error=permanently_denied');
    expect(screen.getByRole('alert')).toHaveTextContent(/has been denied/i);
  });
});
