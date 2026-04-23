import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminOnlyRoute from '../../client/src/components/AdminOnlyRoute';

// ---- Mock useAuth ----

const mockUseAuth = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ---- Helpers ----

function makeUser(role: string) {
  return {
    id: 1,
    email: 'user@example.com',
    displayName: 'Test User',
    role,
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

function renderWithRoutes(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<AdminOnlyRoute />}>
          <Route path="/protected" element={<div>Protected Content</div>} />
        </Route>
        <Route path="/account" element={<div>Account Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---- Tests ----

describe('AdminOnlyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders outlet (protected content) when user has role admin (lowercase)', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser('admin'),
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders outlet (protected content) when user has role ADMIN (uppercase)', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser('ADMIN'),
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('renders outlet (protected content) when user has role Admin (mixed case)', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser('Admin'),
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('redirects to /account when user has role student', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser('student'),
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Account Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects to /account when user has role staff', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser('staff'),
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Account Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('redirects to /account when user is null (unauthenticated)', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Account Page')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('shows loading spinner while auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      logout: vi.fn(),
    });

    renderWithRoutes('/protected');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Account Page')).not.toBeInTheDocument();
  });
});
