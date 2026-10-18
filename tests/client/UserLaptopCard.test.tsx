/**
 * Tests for UserLaptopCard (sprint 002 "laptop accounts" T006, SUC-007).
 *
 * Covers:
 *  - renders the state pill and line from GET /api/admin/users/:id for each
 *    state; the "Sync pending" indicator follows laptop_roster_dirty
 *  - no Allow toggle exists (the login is the account's username and password)
 *  - "Push now" is rendered only while laptop_roster_dirty (repair action);
 *    it POSTs /api/admin/users/:id/laptop/push and toasts the outcome
 *    (success for written, error for failed); a server error is shown
 *    inline and toasted
 *  - StateLine / describeOutcome helpers
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserLaptopCard, {
  describeOutcome,
  StateLine,
  type LaptopDetail,
} from '../../client/src/pages/admin/UserLaptopCard';
import { ToastProvider } from '../../client/src/context/ToastContext';

const BASE: LaptopDetail = {
  id: 7,
  role: 'student',
  username: 'alice',
  laptop_roster_dirty: false,
  laptop_login_state: 'ready',
};

type FetchCall = { url: string; method: string; body: any };
let calls: FetchCall[] = [];

function jsonResponse(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setFetch(state: { current: LaptopDetail }, onWrite: (call: FetchCall) => any) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const call = { url, method, body };
      calls.push(call);
      if (method === 'GET') return jsonResponse(200, state.current);
      return onWrite(call);
    }),
  );
}

function renderCard(userId = 7) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <UserLaptopCard userId={userId} userName="Alice" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((c) => c.method !== 'GET');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StateLine / describeOutcome', () => {
  it('has one line per state', () => {
    const text = (d: Parameters<typeof StateLine>[0]['detail']) => {
      const { container, unmount } = render(<StateLine detail={d} />);
      const t = container.textContent;
      unmount();
      return t;
    };
    expect(text(BASE)).toBe('Logs in on League laptops as alice with the account password.');
    expect(text({ ...BASE, laptop_login_state: 'needs_password' })).toBe(
      'Set a password (Credentials card above) to enable laptop login.',
    );
    expect(text({ ...BASE, laptop_login_state: 'invalid_username', username: 'Alice' })).toBe(
      'Username must be 3–32 lowercase letters, digits or dashes to work on laptops.',
    );
    expect(text({ ...BASE, laptop_login_state: 'disabled' })).toBe(
      'Account is deactivated; laptop login is locked.',
    );
  });

  it('has one toast per outcome', () => {
    expect(describeOutcome('written')).toMatch(/written/);
    expect(describeOutcome('locked')).toMatch(/locked/);
    expect(describeOutcome('unchanged')).toMatch(/up to date/);
    expect(describeOutcome('skipped')).toMatch(/Nothing to write/);
    expect(describeOutcome('failed')).toMatch(/failed/);
  });
});

describe('UserLaptopCard — render', () => {
  it('shows the ready state with the username, no dirty indicator and no Push now', async () => {
    setFetch({ current: BASE }, () => jsonResponse(200, {}));
    renderCard();
    expect(await screen.findByTestId('laptop-state-pill')).toHaveTextContent('ready');
    expect(screen.getByTestId('laptop-state-line')).toHaveTextContent('Logs in on League laptops as alice with the account password.');
    expect(screen.queryByTestId('laptop-dirty')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Writes are automatic; Push now is a repair action for dirty rows only.
    expect(screen.queryByRole('button', { name: 'Push now' })).not.toBeInTheDocument();
    expect(calls[0]).toMatchObject({ url: '/api/admin/users/7', method: 'GET' });
  });

  it('shows Sync pending and the Push now button when laptop_roster_dirty', async () => {
    setFetch({ current: { ...BASE, laptop_roster_dirty: true } }, () => jsonResponse(200, {}));
    renderCard();
    expect(await screen.findByTestId('laptop-dirty')).toHaveTextContent('Sync pending');
    expect(screen.getByRole('button', { name: 'Push now' })).toBeEnabled();
  });

  it('shows disabled for a deactivated account', async () => {
    setFetch({ current: { ...BASE, laptop_login_state: 'disabled' } }, () => jsonResponse(200, {}));
    renderCard();
    expect(await screen.findByTestId('laptop-state-pill')).toHaveTextContent('disabled');
    expect(screen.getByTestId('laptop-state-line')).toHaveTextContent(
      'Account is deactivated; laptop login is locked.',
    );
  });

  it('shows needs_password and invalid_username lines', async () => {
    const state = { current: { ...BASE, laptop_login_state: 'needs_password' as const } };
    setFetch(state, () => jsonResponse(200, {}));
    const { unmount } = renderCard();
    expect(await screen.findByTestId('laptop-state-line')).toHaveTextContent('Set a password (Credentials card above)');
    unmount();

    setFetch({ current: { ...BASE, username: 'Alice', laptop_login_state: 'invalid_username' } }, () =>
      jsonResponse(200, {}),
    );
    renderCard();
    expect(await screen.findByTestId('laptop-state-line')).toHaveTextContent('Username must be 3–32 lowercase letters');
  });
});

describe('UserLaptopCard — actions', () => {
  it('Push now POSTs the push endpoint and toasts the outcome', async () => {
    const state = { current: { ...BASE, laptop_roster_dirty: true } };
    setFetch(state, () => {
      state.current = { ...BASE, laptop_roster_dirty: false };
      return jsonResponse(200, { outcome: 'written', laptopLogin: { state: 'ready', dirty: false } });
    });
    renderCard();
    expect(await screen.findByTestId('laptop-dirty')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Push now' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ url: '/api/admin/users/7/laptop/push', method: 'POST' });
    expect(await screen.findByText('Laptop login written to the roster.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('laptop-dirty')).not.toBeInTheDocument());
  });

  it('a failed outcome is an error toast and the dirty indicator stays', async () => {
    const state = { current: { ...BASE, laptop_roster_dirty: true } };
    setFetch(state, () => {
      state.current = { ...BASE, laptop_roster_dirty: true };
      return jsonResponse(200, { outcome: 'failed', laptopLogin: { state: 'ready', dirty: true } });
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Push now' }));

    expect(await screen.findByText(/Roster write failed/)).toBeInTheDocument();
    expect(await screen.findByTestId('laptop-dirty')).toBeInTheDocument();
  });

  it('shows a server error inline (503 not configured)', async () => {
    setFetch(
      { current: { ...BASE, laptop_roster_dirty: true } },
      () => jsonResponse(503, { error: 'Laptop roster is not configured' }),
    );
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Push now' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Laptop roster is not configured');
  });
});
