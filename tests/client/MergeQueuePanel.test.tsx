/**
 * Tests for MergeQueuePanel (sprint 002 "laptop accounts" T008, SUC-005).
 *
 * Covers:
 *  - the detail view shows username, created via / laptop host, proxy token
 *    usage and group names side by side for both users
 *  - the Approve confirmation lists what the non-survivor loses under the
 *    chosen survivor, and says so when nothing is dropped
 *  - describeLosses helper rules
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MergeQueuePanel, { describeLosses, type UserDetail } from '../../client/src/pages/admin/MergeQueuePanel';

function user(overrides: Partial<UserDetail> & { id: number }): UserDetail {
  return {
    display_name: `User ${overrides.id}`,
    primary_email: `user${overrides.id}@example.com`,
    cohort_id: null,
    is_active: true,
    username: null,
    created_via: 'social_login',
    created_host: null,
    llm_proxy_token: null,
    groups: [],
    logins: [],
    external_accounts: [],
    ...overrides,
  };
}

const alice = user({
  id: 1,
  display_name: 'Alice Smith',
  primary_email: 'alice@gmail.com',
  username: 'alice',
  llm_proxy_token: { tokens_used: 12000, token_limit: 50000 },
  groups: ['Botball 26', 'Robotics'],
  logins: [{ id: 1, provider: 'google', provider_email: 'alice@gmail.com' }],
  external_accounts: [{ id: 1, type: 'workspace', status: 'active' }],
});

const bob = user({
  id: 2,
  display_name: 'alice',
  primary_email: 'bob@laptop.invalid',
  username: 'bob',
  created_via: 'laptop_import',
  created_host: 'jtl-inspiron-ABC123',
  llm_proxy_token: { tokens_used: 300, token_limit: 50000 },
  groups: ['Botball 26'],
  logins: [{ id: 2, provider: 'username', provider_email: null }],
  external_accounts: [{ id: 2, type: 'workspace', status: 'pending' }],
});

const queueItem = {
  id: 7,
  user_a: { id: 1, display_name: 'Alice Smith', primary_email: 'alice@gmail.com' },
  user_b: { id: 2, display_name: 'alice', primary_email: 'bob@laptop.invalid' },
  haiku_confidence: 1,
  haiku_rationale: 'same username as email local part',
  status: 'pending',
  created_at: '2026-10-18T00:00:00Z',
};

function detailFor(a: UserDetail, b: UserDetail) {
  return {
    id: 7,
    user_a: a,
    user_b: b,
    haiku_confidence: 1,
    haiku_rationale: 'same username as email local part',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    created_at: '2026-10-18T00:00:00Z',
  };
}

function stubFetch(detail: unknown) {
  const calls: Array<{ url: string; method: string; body: any }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (url === '/api/admin/merge-queue') return { ok: true, status: 200, json: async () => [queueItem] };
      if (url === '/api/admin/merge-queue/7') return { ok: true, status: 200, json: async () => detail };
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    }),
  );
  return calls;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MergeQueuePanel />
    </QueryClientProvider>,
  );
}

async function openDetail() {
  renderPanel();
  fireEvent.click(await screen.findByLabelText('Review suggestion 7'));
  await screen.findByText('Review Merge Suggestion #7');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MergeQueuePanel detail view — T008 columns', () => {
  it('shows username, created via / host, proxy token usage and groups for both users', async () => {
    stubFetch(detailFor(alice, bob));
    await openDetail();

    const cardA = screen.getByTestId('merge-user-1');
    const cardB = screen.getByTestId('merge-user-2');

    expect(within(cardA).getByText('alice', { selector: 'span' })).toBeInTheDocument();
    expect(within(cardA).getByText('social_login')).toBeInTheDocument();
    expect(within(cardA).getByText(/active — 12,000 \/ 50,000 tokens used/)).toBeInTheDocument();
    expect(within(cardA).getByText('Botball 26, Robotics')).toBeInTheDocument();

    expect(within(cardB).getByText('bob')).toBeInTheDocument();
    expect(within(cardB).getByText('laptop_import (laptop jtl-inspiron-ABC123)')).toBeInTheDocument();
    expect(within(cardB).getByText(/active — 300 \/ 50,000 tokens used/)).toBeInTheDocument();
    expect(within(cardB).getByText('Botball 26')).toBeInTheDocument();
  });

  it('renders "none" and dashes when a user has no token, username or groups', async () => {
    stubFetch(detailFor(user({ id: 1 }), bob));
    await openDetail();

    const cardA = screen.getByTestId('merge-user-1');
    expect(within(cardA).getByText('none')).toBeInTheDocument();
    expect(within(cardA).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('MergeQueuePanel approve confirmation — losses', () => {
  it('lists what the non-survivor loses under the chosen survivor', async () => {
    stubFetch(detailFor(alice, bob));
    await openDetail();

    fireEvent.click(screen.getByLabelText('User A is survivor'));
    fireEvent.click(screen.getByLabelText('Approve merge'));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm merge' });
    const losses = within(dialog).getByTestId('merge-losses');
    expect(losses).toHaveTextContent('alice loses:');
    expect(losses).toHaveTextContent('username bob is dropped; survivor keeps alice');
    expect(losses).toHaveTextContent('LLM proxy token is revoked; its 300 tokens of usage are added');
    expect(losses).toHaveTextContent('workspace account is marked removed');
    expect(losses).toHaveTextContent('duplicate membership in Botball 26 is dropped');
  });

  it('flips the list when the other user is the survivor, and confirms with that survivorId', async () => {
    const calls = stubFetch(detailFor(alice, bob));
    await openDetail();

    fireEvent.click(screen.getByLabelText('User B is survivor'));
    fireEvent.click(screen.getByLabelText('Approve merge'));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm merge' });
    expect(within(dialog).getByTestId('merge-losses')).toHaveTextContent('username alice is dropped; survivor keeps bob');
    expect(within(dialog).getByTestId('merge-losses')).toHaveTextContent('its 12,000 tokens of usage');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Merge' }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST')).toBe(true);
    });
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/admin/merge-queue/7/approve');
    expect(post.body).toEqual({ survivorId: 2 });
  });

  it('says nothing is dropped when there are no conflicts', async () => {
    stubFetch(detailFor(user({ id: 1, display_name: 'Solo One' }), bob));
    await openDetail();

    fireEvent.click(screen.getByLabelText('User A is survivor'));
    fireEvent.click(screen.getByLabelText('Approve merge'));

    const dialog = await screen.findByRole('dialog', { name: 'Confirm merge' });
    expect(within(dialog).getByTestId('merge-losses')).toHaveTextContent(
      'Nothing is dropped: alice has nothing that conflicts with Solo One.',
    );
  });
});

describe('describeLosses', () => {
  it('returns an empty list when the survivor has none of the conflicting items', () => {
    expect(describeLosses(user({ id: 1 }), bob)).toEqual([]);
  });

  it('reports username, token, external account and shared group conflicts', () => {
    const losses = describeLosses(alice, bob);
    expect(losses).toHaveLength(4);
    expect(losses[0]).toMatch(/^username bob is dropped; survivor keeps alice/);
    expect(losses[1]).toMatch(/^LLM proxy token is revoked; its 300 tokens/);
    expect(losses[2]).toBe('workspace account is marked removed; survivor keeps its own');
    expect(losses[3]).toBe('duplicate membership in Botball 26 is dropped (survivor is already a member)');
  });

  it('ignores removed / suspended external accounts', () => {
    const survivor = user({ id: 1, external_accounts: [{ id: 1, type: 'claude', status: 'removed' }] });
    const other = user({ id: 2, external_accounts: [{ id: 2, type: 'claude', status: 'active' }] });
    expect(describeLosses(survivor, other)).toEqual([]);
  });
});
