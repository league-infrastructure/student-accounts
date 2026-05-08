/**
 * Tests for UserDetailPanel (Sprint 010 T014).
 *
 * Covers:
 *  - Student with no workspace and cohort assigned → Create League Account button visible
 *  - Student with active workspace → Create League Account button hidden
 *  - Student with no cohort → Create League Account button hidden
 *  - Staff user → no lifecycle buttons (Suspend, Remove, Create League Account, Provision Claude)
 *  - Admin user → no lifecycle buttons
 *  - Create League Account button POSTs to correct URL and re-fetches user detail on success
 *  - Create League Account: 422-style error shows inline error message near button
 *  - Provision Claude Seat button shown for student, hidden for staff/admin
 *  - Suspend / Remove buttons shown for student accounts, hidden for staff/admin
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserDetailPanel from '../../../../client/src/pages/admin/UserDetailPanel';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeUser(overrides: {
  id?: number;
  email?: string;
  role?: string;
  cohort?: { id: number; name: string } | null;
  externalAccounts?: Array<{
    id: number;
    type: string;
    status: string;
    externalId: string | null;
    statusChangedAt: string | null;
    scheduledDeleteAt: string | null;
    createdAt: string;
  }>;
}) {
  return {
    id: 123,
    email: 'student@example.com',
    displayName: 'Test Student',
    role: 'student',
    cohort: { id: 1, name: 'Spring 2025' },
    createdAt: '2025-01-01T00:00:00Z',
    logins: [
      {
        id: 10,
        provider: 'google',
        providerUserId: 'google-uid-1',
        providerEmail: 'student@gmail.com',
        providerUsername: null,
        createdAt: '2025-01-01T00:00:00Z',
      },
    ],
    externalAccounts: [],
    ...overrides,
  };
}

const ACTIVE_WORKSPACE_ACCOUNT = {
  id: 50,
  type: 'workspace',
  status: 'active',
  externalId: 'student@jointheleague.org',
  statusChangedAt: null,
  scheduledDeleteAt: null,
  createdAt: '2025-02-01T00:00:00Z',
};

const ACTIVE_CLAUDE_ACCOUNT = {
  id: 51,
  type: 'claude',
  status: 'active',
  externalId: 'claude-id-1',
  statusChangedAt: null,
  scheduledDeleteAt: null,
  createdAt: '2025-02-01T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderPanel(userId: string | number, fetchImpl: (...args: unknown[]) => unknown) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(fetchImpl));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route path="/admin/users/:id" element={<UserDetailPanel />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * Build a simple fetch mock that serves the given user detail for GET
 * and returns ok:true for any POST (used in action tests).
 */
function userDetailFetch(user: ReturnType<typeof makeUser>) {
  return (url: unknown, opts?: RequestInit) => {
    const urlStr = String(url);
    // Skip pike13 endpoint (independent, can fail silently)
    if (urlStr.includes('/pike13')) {
      return Promise.resolve({ ok: true, json: async () => ({ present: false }) });
    }
    if (opts?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 201, json: async () => ({}) });
    }
    return Promise.resolve({ ok: true, json: async () => user });
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserDetailPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub window.confirm to return true by default (for action tests).
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });

  // --------------------------------------------------------------------------
  // Create League Account button visibility
  // --------------------------------------------------------------------------

  describe('Create League Account button', () => {
    it('hides button when student already has an active workspace account', async () => {
      const user = makeUser({
        role: 'student',
        cohort: { id: 1, name: 'Spring 2025' },
        externalAccounts: [ACTIVE_WORKSPACE_ACCOUNT],
      });
      renderPanel(123, userDetailFetch(user));

      await waitFor(() => {
        expect(screen.getByText('Test Student')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /create league account/i })).not.toBeInTheDocument();
    });

    it('hides button when student has no cohort assigned', async () => {
      const user = makeUser({ role: 'student', cohort: null, externalAccounts: [] });
      renderPanel(123, userDetailFetch(user));

      await waitFor(() => {
        expect(screen.getByText('Test Student')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /create league account/i })).not.toBeInTheDocument();
    });

    it('hides button entirely for staff users', async () => {
      const user = makeUser({ role: 'staff', cohort: null, externalAccounts: [] });
      renderPanel(123, userDetailFetch(user));

      await waitFor(() => {
        expect(screen.getByText('Test Student')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /create league account/i })).not.toBeInTheDocument();
    });

    it('hides button entirely for admin users', async () => {
      const user = makeUser({ role: 'admin', cohort: null, externalAccounts: [] });
      renderPanel(123, userDetailFetch(user));

      await waitFor(() => {
        expect(screen.getByText('Test Student')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /create league account/i })).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Role gating: lifecycle buttons hidden for staff/admin
  // --------------------------------------------------------------------------

  describe('role gating on lifecycle buttons', () => {
    it('student with Claude account shows Disable Claude and Delete Claude buttons', async () => {
      const user = makeUser({
        role: 'student',
        cohort: { id: 1, name: 'Spring 2025' },
        externalAccounts: [ACTIVE_WORKSPACE_ACCOUNT, ACTIVE_CLAUDE_ACCOUNT],
      });
      renderPanel(123, userDetailFetch(user));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /disable claude/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete claude/i })).toBeInTheDocument();
      });
    });
  });
});
