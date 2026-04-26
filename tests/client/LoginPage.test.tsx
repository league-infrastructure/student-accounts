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

// ---- Helpers ----

/** Build a fetch mock that returns the given provider status from /api/integrations/status.
 *  Additional handlers can be passed as an optional override function.
 */
function mockFetchStatus(
  status: { github?: boolean; google?: boolean; pike13?: boolean },
  overrides?: (url: string, init?: RequestInit) => Response | null,
) {
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (overrides) {
      const result = overrides(url, init);
      if (result !== null) return Promise.resolve(result);
    }
    if (url === '/api/integrations/status') {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            github: { configured: !!status.github },
            google: { configured: !!status.google },
            pike13: { configured: !!status.pike13 },
          }),
      });
    }
    // Default: network error for unexpected fetches
    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

function makeJsonResponse(status: number, body: object): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationAssign.mockClear();
    // Default: all providers unconfigured
    mockFetchStatus({});
  });

  // -- Login form field type and label tests --

  it('renders login passphrase input with type="text"', () => {
    renderLogin();
    const passphraseInput = screen.getByLabelText(/^passphrase$/i) as HTMLInputElement;
    expect(passphraseInput.type).toBe('text');
  });

  it('renders label "Passphrase" (not "Password") on login form', () => {
    renderLogin();
    expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password$/i)).not.toBeInTheDocument();
  });

  it('renders form with username field', () => {
    renderLogin();
    expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
  });

  // -- Login form submission tests --

  it('submits login to /api/auth/login via loginWithCredentials', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passphraseInput = screen.getByLabelText(/^passphrase$/i);

    await user.type(usernameInput, 'student1');
    await user.type(passphraseInput, 'green-dog-seven');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('student1', 'green-dog-seven');
    });
  });

  it('calls window.location.assign("/account") on successful login', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passphraseInput = screen.getByLabelText(/^passphrase$/i);

    await user.type(usernameInput, 'student1');
    await user.type(passphraseInput, 'green-dog-seven');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith('/account');
    });
  });

  it('shows inline error on 401 from login', async () => {
    mockLoginWithCredentials.mockResolvedValue({
      ok: false,
      error: 'Invalid username or password',
    });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passphraseInput = screen.getByLabelText(/^passphrase$/i);

    await user.type(usernameInput, 'student1');
    await user.type(passphraseInput, 'wrong');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid username or password');
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it('does not redirect when login credentials are invalid', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/^username$/i);
    const passphraseInput = screen.getByLabelText(/^passphrase$/i);

    await user.type(usernameInput, 'student1');
    await user.type(passphraseInput, 'bad');

    await user.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  // -- Signup disclosure panel tests --

  it('renders the signup disclosure panel with correct label', () => {
    renderLogin();
    expect(
      screen.getByText(/new student\? sign up with a class passphrase/i),
    ).toBeInTheDocument();
  });

  it('signup form is hidden by default', () => {
    renderLogin();
    expect(screen.queryByRole('button', { name: /^sign up$/i })).not.toBeInTheDocument();
  });

  it('expanding the disclosure reveals the signup form', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    expect(screen.getByRole('button', { name: /^sign up$/i })).toBeInTheDocument();
  });

  it('signup form has username and passphrase fields', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    // After expanding, there should be two username/passphrase field pairs
    const usernameInputs = screen.getAllByLabelText(/^username$/i);
    expect(usernameInputs.length).toBeGreaterThanOrEqual(1);

    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i);
    expect(passphraseInputs.length).toBeGreaterThanOrEqual(2);
  });

  it('signup passphrase input is type="text"', async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i) as HTMLInputElement[];
    passphraseInputs.forEach((input) => {
      expect(input.type).toBe('text');
    });
  });

  it('submits signup form to /api/auth/passphrase-signup', async () => {
    mockFetchStatus({}, (url) => {
      if (url === '/api/auth/passphrase-signup') {
        return makeJsonResponse(200, { ok: true });
      }
      return null;
    });

    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    const usernameInputs = screen.getAllByLabelText(/^username$/i);
    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i);

    // The signup form inputs are the last ones in the DOM
    const signupUsername = usernameInputs[usernameInputs.length - 1];
    const signupPassphrase = passphraseInputs[passphraseInputs.length - 1];

    await user.type(signupUsername, 'newstudent');
    await user.type(signupPassphrase, 'blue-fish-nine');

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/auth/passphrase-signup',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ username: 'newstudent', passphrase: 'blue-fish-nine' }),
        }),
      );
    });
  });

  it('calls window.location.assign("/account") on successful signup', async () => {
    mockFetchStatus({}, (url) => {
      if (url === '/api/auth/passphrase-signup') {
        return makeJsonResponse(200, { ok: true });
      }
      return null;
    });

    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    const usernameInputs = screen.getAllByLabelText(/^username$/i);
    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i);

    const signupUsername = usernameInputs[usernameInputs.length - 1];
    const signupPassphrase = passphraseInputs[passphraseInputs.length - 1];

    await user.type(signupUsername, 'newstudent');
    await user.type(signupPassphrase, 'blue-fish-nine');

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(mockLocationAssign).toHaveBeenCalledWith('/account');
    });
  });

  it('shows "Invalid or expired passphrase" on 401 from signup', async () => {
    mockFetchStatus({}, (url) => {
      if (url === '/api/auth/passphrase-signup') {
        return makeJsonResponse(401, { error: 'Passphrase not found' });
      }
      return null;
    });

    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    const usernameInputs = screen.getAllByLabelText(/^username$/i);
    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i);

    const signupUsername = usernameInputs[usernameInputs.length - 1];
    const signupPassphrase = passphraseInputs[passphraseInputs.length - 1];

    await user.type(signupUsername, 'newstudent');
    await user.type(signupPassphrase, 'wrong-phrase');

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired passphrase');
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  it('shows "That username is already taken" on 409 from signup', async () => {
    mockFetchStatus({}, (url) => {
      if (url === '/api/auth/passphrase-signup') {
        return makeJsonResponse(409, { error: 'Username taken' });
      }
      return null;
    });

    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByText(/new student\? sign up with a class passphrase/i));

    const usernameInputs = screen.getAllByLabelText(/^username$/i);
    const passphraseInputs = screen.getAllByLabelText(/^passphrase$/i);

    const signupUsername = usernameInputs[usernameInputs.length - 1];
    const signupPassphrase = passphraseInputs[passphraseInputs.length - 1];

    await user.type(signupUsername, 'takenuser');
    await user.type(signupPassphrase, 'valid-phrase');

    await user.click(screen.getByRole('button', { name: /^sign up$/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('That username is already taken');
    });
    expect(mockLocationAssign).not.toHaveBeenCalled();
  });

  // -- Provider button tests --

  describe('provider buttons', () => {
    it('shows no provider buttons when all providers are unconfigured', async () => {
      mockFetchStatus({});
      renderLogin();

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
      });

      // Give state update a moment to propagate
      await new Promise((r) => setTimeout(r, 50));

      expect(screen.queryByText(/sign in with github/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sign in with pike 13/i)).not.toBeInTheDocument();
    });

    it('hides the divider when no providers are configured', async () => {
      mockFetchStatus({});
      renderLogin();

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(screen.queryByText(/or sign in with/i)).not.toBeInTheDocument();
    });

    it('shows only the GitHub button when only GitHub is configured', async () => {
      mockFetchStatus({ github: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with github/i)).toBeInTheDocument();
      });

      expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sign in with pike 13/i)).not.toBeInTheDocument();
    });

    it('GitHub button links to /api/auth/github', async () => {
      mockFetchStatus({ github: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with github/i)).toBeInTheDocument();
      });

      const githubLink = screen.getByText(/sign in with github/i).closest('a');
      expect(githubLink).toHaveAttribute('href', '/api/auth/github');
    });

    it('shows all three provider buttons when all are configured', async () => {
      mockFetchStatus({ github: true, google: true, pike13: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with github/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
      expect(screen.getByText(/sign in with pike 13/i)).toBeInTheDocument();
    });

    it('renders provider buttons in GitHub, Google, Pike 13 order', async () => {
      mockFetchStatus({ github: true, google: true, pike13: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with github/i)).toBeInTheDocument();
      });

      const links = screen.getAllByRole('link');
      const providerLinks = links.filter((l) =>
        /sign in with (github|google|pike 13)/i.test(l.textContent ?? ''),
      );

      expect(providerLinks[0]).toHaveTextContent(/github/i);
      expect(providerLinks[1]).toHaveTextContent(/google/i);
      expect(providerLinks[2]).toHaveTextContent(/pike 13/i);
    });

    it('shows the divider when at least one provider is configured', async () => {
      mockFetchStatus({ google: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/or sign in with/i)).toBeInTheDocument();
      });
    });

    it('login form still renders when providers are configured', async () => {
      mockFetchStatus({ github: true, google: true, pike13: true });
      renderLogin();

      // Form is present immediately (synchronous render)
      expect(screen.getByLabelText(/^username$/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    });

    it('shows no provider buttons when fetch fails (graceful failure)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      renderLogin();

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
      });

      // Give the state update a moment to propagate
      await new Promise((r) => setTimeout(r, 50));

      expect(screen.queryByText(/sign in with github/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sign in with google/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/sign in with pike 13/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/or sign in with/i)).not.toBeInTheDocument();
    });

    it('Google button links to /api/auth/google', async () => {
      mockFetchStatus({ google: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
      });

      const googleLink = screen.getByText(/sign in with google/i).closest('a');
      expect(googleLink).toHaveAttribute('href', '/api/auth/google');
    });

    it('Pike 13 button links to /api/auth/pike13', async () => {
      mockFetchStatus({ pike13: true });
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText(/sign in with pike 13/i)).toBeInTheDocument();
      });

      const pike13Link = screen.getByText(/sign in with pike 13/i).closest('a');
      expect(pike13Link).toHaveAttribute('href', '/api/auth/pike13');
    });
  });
});
