import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Login from '../../client/src/pages/Login';

// ---- Mock AuthContext ----

const mockLoginWithCredentials = vi.fn();
const mockNavigate = vi.fn();

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
    useNavigate: () => mockNavigate,
  };
});

// ---- Helpers ----

/** Build a fetch mock that returns the given provider status from /api/integrations/status */
function mockFetchStatus(status: {
  github?: boolean;
  google?: boolean;
  pike13?: boolean;
}) {
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
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
    // Default: all providers unconfigured
    mockFetchStatus({});
  });

  // -- Existing demo form tests --

  it('renders form with username pre-filled as "user"', () => {
    renderLogin();
    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    expect(usernameInput.value).toBe('user');
  });

  it('renders form with password pre-filled as "pass"', () => {
    renderLogin();
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    expect(passwordInput.value).toBe('pass');
  });

  it('redirects to / on successful login', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('user', 'pass');
      expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
    });
  });

  it('shows error message on 401 (invalid credentials)', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid credentials' });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials');
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not redirect when credentials are invalid', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: false, error: 'Invalid username or password' });
    const user = userEvent.setup();

    renderLogin();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('calls loginWithCredentials with typed credentials', async () => {
    mockLoginWithCredentials.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    renderLogin();

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.clear(usernameInput);
    await user.type(usernameInput, 'admin');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'admin');

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLoginWithCredentials).toHaveBeenCalledWith('admin', 'admin');
    });
  });

  // -- Provider button tests --

  describe('provider buttons', () => {
    it('shows no provider buttons when all providers are unconfigured', async () => {
      mockFetchStatus({});
      renderLogin();

      // Wait for the hook to resolve
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/integrations/status');
      });

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

    it('demo form still renders when providers are configured', async () => {
      mockFetchStatus({ github: true, google: true, pike13: true });
      renderLogin();

      // Form is present immediately (synchronous render)
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('shows no provider buttons when fetch fails (graceful failure)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      renderLogin();

      // After the fetch failure resolves, loading becomes false but all are false
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
