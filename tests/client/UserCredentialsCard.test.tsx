/**
 * Tests for UserCredentialsCard (sprint 002 "laptop accounts" T005).
 *
 * Covers:
 *  - Renders the current username / password state from the GET
 *  - Save username PUTs { username }; a 400 shows the server's rule message
 *  - Set password: min length and confirm mismatch refused client-side;
 *    a good pair PUTs { password } and the plaintext is shown once
 *  - Generate PUTs { generatePassword: true }; the returned password is shown
 *    once with Copy and the GET never brings it back
 *  - Email dialog: To prefilled from notificationEmail ?? primaryEmail,
 *    empty when that ends in .invalid; the "include password" checkbox is
 *    disabled with no plaintext and checked when there is one; Send POSTs
 *    { to, password, note }; the plaintext is cleared after a send
 *  - defaultRecipient / isUndeliverable helpers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserCredentialsCard, {
  defaultRecipient,
  isUndeliverable,
  type CredentialsState,
} from '../../client/src/pages/admin/UserCredentialsCard';
import { ToastProvider } from '../../client/src/context/ToastContext';

const BASE: CredentialsState = {
  username: 'alice',
  hasPassword: false,
  allowsLaptopAccount: true,
  laptopLogin: false,
  displayName: 'Alice Liddell',
  primaryEmail: 'alice@example.com',
  notificationEmail: null,
};

type FetchCall = { url: string; method: string; body: any };
let calls: FetchCall[] = [];

function jsonResponse(status: number, body: any) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Fetch mock: GET serves `state` (mutable so a test can change what the
 * refetch returns); PUT/POST are answered by `onWrite`.
 */
function setFetch(state: { current: CredentialsState }, onWrite: (call: FetchCall) => any) {
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
        <UserCredentialsCard userId={userId} userName="Alice" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const writes = () => calls.filter((c) => c.method !== 'GET');

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('defaultRecipient / isUndeliverable', () => {
  it('prefers notificationEmail, falls back to primaryEmail, blanks .invalid', () => {
    expect(defaultRecipient({ notificationEmail: 'parent@example.com', primaryEmail: 'a@b.com' })).toBe(
      'parent@example.com',
    );
    expect(defaultRecipient({ notificationEmail: null, primaryEmail: 'a@b.com' })).toBe('a@b.com');
    expect(defaultRecipient({ notificationEmail: null, primaryEmail: 'alice@laptop.invalid' })).toBe('');
    expect(defaultRecipient({ notificationEmail: 'x@y.invalid', primaryEmail: 'a@b.com' })).toBe('');
    expect(defaultRecipient(undefined)).toBe('');
    expect(isUndeliverable('alice@laptop.invalid')).toBe(true);
    expect(isUndeliverable('alice@INVALID')).toBe(true);
    expect(isUndeliverable('alice@example.com')).toBe(false);
    expect(isUndeliverable('nope')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Render + username
// ---------------------------------------------------------------------------

describe('UserCredentialsCard — username', () => {
  it('shows the current username and password state', async () => {
    setFetch({ current: BASE }, () => jsonResponse(200, {}));
    renderCard();
    const input = (await screen.findByLabelText('Username')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('alice'));
    expect(screen.getByText('No password set.')).toBeInTheDocument();
    expect(screen.getByText(/Laptop login rules/)).toBeInTheDocument();
  });

  it('PUTs { username } on Save and refetches', async () => {
    const state = { current: BASE };
    setFetch(state, (call) => {
      state.current = { ...BASE, username: call.body.username };
      return jsonResponse(200, { username: call.body.username });
    });
    renderCard();
    const input = (await screen.findByLabelText('Username')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('alice'));

    fireEvent.change(input, { target: { value: 'alice-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      url: '/api/admin/users/7/credentials',
      method: 'PUT',
      body: { username: 'alice-2' },
    });
    await waitFor(() => expect(screen.getByText(/Username set to alice-2/)).toBeInTheDocument());
  });

  it('shows the server validation message on a 400', async () => {
    const RULE = 'Usernames for laptop login are 3-32 characters: lowercase letters, digits and dashes, starting with a letter or digit.';
    setFetch({ current: BASE }, () => jsonResponse(400, { error: RULE }));
    renderCard();
    const input = (await screen.findByLabelText('Username')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('alice'));

    fireEvent.change(input, { target: { value: 'Student' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save username' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(RULE);
  });
});

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

describe('UserCredentialsCard — set password', () => {
  it('refuses a short password and a mismatch without calling the server', async () => {
    setFetch({ current: BASE }, () => jsonResponse(200, {}));
    renderCard();
    await screen.findByText('No password set.');

    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 4 characters/);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'purple-cactus' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'purple-cactis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/);

    expect(writes()).toHaveLength(0);
  });

  it('PUTs { password } and shows the plaintext once', async () => {
    const state = { current: BASE };
    setFetch(state, (call) => {
      state.current = { ...BASE, hasPassword: true };
      return jsonResponse(200, { username: 'alice', password: call.body.password });
    });
    renderCard();
    await screen.findByText('No password set.');

    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'purple-cactus-river' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'purple-cactus-river' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    const box = await screen.findByTestId('credentials-plaintext');
    expect(within(box).getByText('purple-cactus-river')).toBeInTheDocument();
    expect(writes()[0]).toMatchObject({ method: 'PUT', body: { password: 'purple-cactus-river' } });
    await waitFor(() => expect(screen.getByText('A password is set.')).toBeInTheDocument());
  });
});

describe('UserCredentialsCard — generate', () => {
  it('PUTs { generatePassword: true } and shows the result once with Copy; Hide clears it', async () => {
    const state = { current: BASE };
    setFetch(state, () => {
      state.current = { ...BASE, hasPassword: true };
      return jsonResponse(200, { username: 'alice', password: 'maple-robot-seven' });
    });
    renderCard();
    await screen.findByText('No password set.');

    fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));

    const box = await screen.findByTestId('credentials-plaintext');
    expect(within(box).getByText('maple-robot-seven')).toBeInTheDocument();
    expect(writes()).toEqual([
      { url: '/api/admin/users/7/credentials', method: 'PUT', body: { generatePassword: true } },
    ]);

    fireEvent.click(within(box).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('maple-robot-seven'));

    // The refetched GET carries no password; only component state does.
    await waitFor(() => expect(screen.getByText('A password is set.')).toBeInTheDocument());
    expect(screen.getByText('maple-robot-seven')).toBeInTheDocument();

    fireEvent.click(within(box).getByRole('button', { name: 'Hide password' }));
    expect(screen.queryByTestId('credentials-plaintext')).toBeNull();
    expect(screen.queryByText('maple-robot-seven')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Email dialog
// ---------------------------------------------------------------------------

describe('UserCredentialsCard — email dialog', () => {
  it('prefills To with notificationEmail and disables the password checkbox without a plaintext', async () => {
    setFetch({ current: { ...BASE, notificationEmail: 'parent@example.com' } }, () => jsonResponse(200, {}));
    renderCard();
    await screen.findByText('No password set.');

    fireEvent.click(screen.getByRole('button', { name: 'Email credentials…' }));

    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('To') as HTMLInputElement).value).toBe('parent@example.com');
    const checkbox = within(dialog).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(checkbox.checked).toBe(false);
  });

  it('falls back to primaryEmail and leaves To empty for a .invalid address', async () => {
    const state = { current: { ...BASE, primaryEmail: 'bob@example.com' } };
    setFetch(state, () => jsonResponse(200, {}));
    const { unmount } = renderCard();
    await screen.findByText('No password set.');
    fireEvent.click(screen.getByRole('button', { name: 'Email credentials…' }));
    expect(((await screen.findByRole('dialog')) && (screen.getByLabelText('To') as HTMLInputElement)).value).toBe(
      'bob@example.com',
    );
    unmount();

    setFetch({ current: { ...BASE, primaryEmail: 'carol@laptop.invalid' } }, () => jsonResponse(200, {}));
    renderCard(8);
    await screen.findByText('No password set.');
    fireEvent.click(screen.getByRole('button', { name: 'Email credentials…' }));
    await screen.findByRole('dialog');
    expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('');
  });

  it('after Generate the checkbox is enabled and checked; Send POSTs to/password/note and clears the plaintext', async () => {
    const state = { current: { ...BASE, notificationEmail: 'parent@example.com' } };
    setFetch(state, (call) => {
      if (call.method === 'PUT') {
        state.current = { ...state.current, hasPassword: true };
        return jsonResponse(200, { username: 'alice', password: 'maple-robot-seven' });
      }
      return jsonResponse(200, { sent: true });
    });
    renderCard();
    await screen.findByText('No password set.');

    fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));
    await screen.findByTestId('credentials-plaintext');

    fireEvent.click(screen.getByRole('button', { name: 'Email credentials…' }));
    const dialog = await screen.findByRole('dialog');
    const checkbox = within(dialog).getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeDisabled();
    expect(checkbox.checked).toBe(true);

    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: 'mum@example.com' } });
    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'See you Tuesday.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({
      url: '/api/admin/users/7/credentials/email',
      method: 'POST',
      body: { to: 'mum@example.com', password: 'maple-robot-seven', note: 'See you Tuesday.' },
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('credentials-plaintext')).toBeNull();
    expect(screen.queryByText('maple-robot-seven')).toBeNull();
    expect(screen.getByText(/Credentials emailed to mum@example.com/)).toBeInTheDocument();
  });

  it('sends without the password when the checkbox is unticked and refuses a .invalid To client-side', async () => {
    const state = { current: BASE };
    setFetch(state, (call) => {
      if (call.method === 'PUT') return jsonResponse(200, { username: 'alice', password: 'maple-robot-seven' });
      return jsonResponse(200, { sent: true });
    });
    renderCard();
    await screen.findByText('No password set.');
    fireEvent.click(screen.getByRole('button', { name: 'Generate password' }));
    await screen.findByTestId('credentials-plaintext');

    fireEvent.click(screen.getByRole('button', { name: 'Email credentials…' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: 'x@laptop.invalid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot receive mail/);
    expect(writes()).toHaveLength(1); // only the PUT

    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: 'parent@example.com' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].body).toEqual({ to: 'parent@example.com' });
  });
});
