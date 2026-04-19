import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import StaffLayout from '../../client/src/pages/staff/StaffLayout';

/* ------------------------------------------------------------------ */
/*  Mock useAuth                                                         */
/* ------------------------------------------------------------------ */

const mockUseAuth = vi.fn();

vi.mock('../../client/src/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeUser(role: string) {
  return {
    id: 1,
    email: 'test@example.com',
    displayName: 'Test User',
    role,
    avatarUrl: null,
    provider: null,
    providerId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

/**
 * Renders StaffLayout inside a router with:
 *  - /staff/directory   → StaffLayout outlet (renders "Staff Page")
 *  - /account           → redirect target for non-staff
 *  - /login             → redirect target for unauthenticated
 *
 * Initial path defaults to /staff/directory.
 */
function renderLayout(initialPath = '/staff/directory') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<StaffLayout />}>
          <Route path="/staff/directory" element={<div>Staff Page</div>} />
        </Route>
        <Route path="/account" element={<div>Account Page</div>} />
        <Route path="/login" element={<div>Login Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe('StaffLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders outlet when user has role=staff', () => {
    mockUseAuth.mockReturnValue({ user: makeUser('staff'), loading: false });
    renderLayout();
    expect(screen.getByText('Staff Page')).toBeInTheDocument();
  });

  it('renders outlet when user has role=admin', () => {
    mockUseAuth.mockReturnValue({ user: makeUser('admin'), loading: false });
    renderLayout();
    expect(screen.getByText('Staff Page')).toBeInTheDocument();
  });

  it('redirects to /account when user has role=student', () => {
    mockUseAuth.mockReturnValue({ user: makeUser('student'), loading: false });
    renderLayout();
    expect(screen.getByText('Account Page')).toBeInTheDocument();
    expect(screen.queryByText('Staff Page')).not.toBeInTheDocument();
  });

  it('redirects to /login when user is null', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false });
    renderLayout();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
    expect(screen.queryByText('Staff Page')).not.toBeInTheDocument();
  });

  it('renders nothing while loading', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true });
    const { container } = renderLayout();
    expect(container.firstChild).toBeNull();
  });
});
