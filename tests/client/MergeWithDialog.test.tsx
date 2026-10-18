/**
 * Tests for MergeWithDialog (sprint 002 "laptop accounts" T008, SUC-005).
 *
 * Covers:
 *  - the "Merge with…" button opens a dialog that loads /api/admin/users once
 *  - the search filters by name, email and login username and excludes self
 *  - picking a user reveals the survivor choice; Merge POSTs
 *    /api/admin/users/:id/merge { otherUserId, survivorId } and calls onMerged
 *  - the other user can be chosen as survivor
 *  - a server error is shown inline and the dialog stays open
 *  - filterCandidates helper
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MergeWithDialog, { filterCandidates } from '../../client/src/pages/admin/MergeWithDialog';
import { ToastProvider } from '../../client/src/context/ToastContext';

const USERS = [
  { id: 1, email: 'alice@gmail.com', displayName: 'Alice Smith', role: 'USER', providers: [] },
  { id: 2, email: 'bob@laptop.invalid', displayName: 'bob', role: 'USER', providers: [{ provider: 'username', username: 'bob', email: null }] },
  { id: 3, email: 'carol@example.com', displayName: 'Carol Lee', role: 'USER', providers: [{ provider: 'github', username: 'clee', email: null }] },
];

type Call = { url: string; method: string; body: any };

function stubFetch(onPost: (call: Call) => any = () => ({ ok: true, status: 200, json: async () => ({ ok: true, survivorId: 1 }) })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      if (method === 'GET' && url === '/api/admin/users') return { ok: true, status: 200, json: async () => USERS };
      if (method === 'POST') return onPost(call);
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
  return calls;
}

function renderDialog(onMerged = vi.fn()) {
  render(
    <ToastProvider>
      <MergeWithDialog userId={1} userName="Alice Smith" onMerged={onMerged} />
    </ToastProvider>,
  );
  return onMerged;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MergeWithDialog', () => {
  it('opens on click, loads the users list once and excludes the current user', async () => {
    const calls = stubFetch();
    renderDialog();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Merge with another user'));

    await screen.findByLabelText('Select bob@laptop.invalid');
    expect(screen.getByLabelText('Select carol@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select alice@gmail.com')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    expect(screen.getByLabelText('Confirm merge')).toBeDisabled();
  });

  it('filters by name, email or login username', async () => {
    stubFetch();
    renderDialog();
    fireEvent.click(screen.getByLabelText('Merge with another user'));
    await screen.findByLabelText('Select bob@laptop.invalid');

    fireEvent.change(screen.getByLabelText('Search users to merge with'), { target: { value: 'clee' } });
    expect(screen.getByLabelText('Select carol@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Select bob@laptop.invalid')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search users to merge with'), { target: { value: 'nobody' } });
    expect(screen.getByText('No matching users.')).toBeInTheDocument();
  });

  it('POSTs the merge with this user as survivor by default and calls onMerged', async () => {
    const calls = stubFetch();
    const onMerged = renderDialog();
    fireEvent.click(screen.getByLabelText('Merge with another user'));
    fireEvent.click(await screen.findByLabelText('Select bob@laptop.invalid'));

    expect(screen.getByLabelText('Keep Alice Smith')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Confirm merge'));

    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(1));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/admin/users/1/merge');
    expect(post.body).toEqual({ otherUserId: 2, survivorId: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets the other user survive', async () => {
    const calls = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, survivorId: 3 }) }));
    const onMerged = renderDialog();
    fireEvent.click(screen.getByLabelText('Merge with another user'));
    fireEvent.click(await screen.findByLabelText('Select carol@example.com'));
    fireEvent.click(screen.getByLabelText('Keep carol@example.com'));
    fireEvent.click(screen.getByLabelText('Confirm merge'));

    await waitFor(() => expect(onMerged).toHaveBeenCalledWith(3));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ otherUserId: 3, survivorId: 3 });
  });

  it('shows a server error inline and keeps the dialog open', async () => {
    stubFetch(() => ({ ok: false, status: 409, json: async () => ({ error: 'User 2 is inactive' }) }));
    const onMerged = renderDialog();
    fireEvent.click(screen.getByLabelText('Merge with another user'));
    fireEvent.click(await screen.findByLabelText('Select bob@laptop.invalid'));
    fireEvent.click(screen.getByLabelText('Confirm merge'));

    expect(await screen.findAllByText('User 2 is inactive')).not.toHaveLength(0);
    expect(screen.getByRole('dialog', { name: 'Merge with another user' })).toBeInTheDocument();
    expect(onMerged).not.toHaveBeenCalled();
  });
});

describe('filterCandidates', () => {
  it('excludes self, matches name / email / provider username, and caps results', () => {
    expect(filterCandidates(USERS, 1, '').map((u) => u.id)).toEqual([2, 3]);
    expect(filterCandidates(USERS, 1, 'CAROL').map((u) => u.id)).toEqual([3]);
    expect(filterCandidates(USERS, 1, 'laptop.invalid').map((u) => u.id)).toEqual([2]);
    expect(filterCandidates(USERS, 1, 'clee').map((u) => u.id)).toEqual([3]);
    expect(filterCandidates(USERS, 1, '', 1).map((u) => u.id)).toEqual([2]);
  });
});
