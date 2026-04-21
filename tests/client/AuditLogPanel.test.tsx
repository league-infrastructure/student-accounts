/**
 * Tests for the AuditLogPanel admin page (Sprint 009 T010).
 *
 * Covers:
 *  - Initial fetch on mount — table renders with event rows
 *  - Loading state while fetch is in-flight
 *  - Error banner when fetch fails
 *  - Empty state when total === 0
 *  - Filter form submits and re-fetches with filter params
 *  - Row click toggles detail expansion (JSON in <pre>)
 *  - Second click collapses the expanded row
 *  - Pagination Previous / Next buttons update page
 *  - Previous button disabled on page 1; Next button disabled on last page
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditLogPanel from '../../client/src/pages/admin/AuditLogPanel';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<ReturnType<typeof baseEvent>> = {}) {
  return { ...baseEvent(), ...overrides };
}

function baseEvent() {
  return {
    id: 1,
    createdAt: '2025-04-10T12:00:00.000Z',
    actorId: 7,
    actorName: 'Alice Admin',
    action: 'provision_workspace',
    targetUserId: 42,
    targetUserName: 'Bob Student',
    targetEntityType: null,
    targetEntityId: null,
    details: { workspace: 'bob@students.org', cohort: 'Spring 2025' },
  };
}

function makeResult(overrides: { total?: number; page?: number; items?: unknown[] } = {}) {
  const items = overrides.items ?? [makeEvent()];
  return {
    total: overrides.total ?? items.length,
    page: overrides.page ?? 1,
    pageSize: 50,
    items,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPanel() {
  return render(
    <MemoryRouter>
      <AuditLogPanel />
    </MemoryRouter>,
  );
}

function mockFetchOnce(data: unknown, ok = true) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    json: async () => data,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditLogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Initial render ----

  it('fetches and renders audit events on mount', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult()));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Admin (#7)')).toBeInTheDocument();
    });

    expect(screen.getByText('Bob Student (#42)')).toBeInTheDocument();
    // The action badge appears in the table row; may also appear in dropdown option
    expect(screen.getAllByText('provision_workspace').length).toBeGreaterThan(0);
  });

  it('renders table column headers', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult()));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Timestamp')).toBeInTheDocument();
    });

    expect(screen.getByText('Actor')).toBeInTheDocument();
    // "Action" appears in both form label and table header
    expect(screen.getAllByText('Action').length).toBeGreaterThan(0);
    expect(screen.getByText('Target User')).toBeInTheDocument();
    expect(screen.getByText('Details Summary')).toBeInTheDocument();
  });

  // ---- Loading state ----

  it('shows loading state while fetch is in-flight', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {}))); // never resolves

    renderPanel();

    // The spinner's aria-label should appear
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  // ---- Error state ----

  it('shows error banner when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Forbidden' }),
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/forbidden/i);
  });

  // ---- Empty state ----

  it('shows empty state message when total is 0', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult({ total: 0, items: [] })));

    renderPanel();

    await waitFor(() => {
      expect(
        screen.getByText(/no audit records match the current filters/i),
      ).toBeInTheDocument();
    });
  });

  // ---- Filter form ----

  it('submits the filter form and re-fetches with filter params', async () => {
    const event2 = makeEvent({
      id: 2,
      action: 'delete_user',
      actorName: 'Carol',
      actorId: 9,
    });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => makeResult() })        // initial
      .mockResolvedValueOnce({ ok: true, json: async () => makeResult({ items: [event2] }) }); // after filter

    vi.stubGlobal('fetch', mockFetch);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Admin (#7)')).toBeInTheDocument();
    });

    // Change the action dropdown to 'delete_user'
    const actionSelect = screen.getByLabelText(/action filter/i);
    fireEvent.change(actionSelect, { target: { value: 'delete_user' } });

    // Submit
    const submitButton = screen.getByRole('button', { name: /search/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Carol (#9)')).toBeInTheDocument();
    });

    // Verify second fetch included the action param
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[0]).toContain('action=delete_user');
  });

  it('resets to page 1 when filter is submitted', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => makeResult() });

    vi.stubGlobal('fetch', mockFetch);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Admin (#7)')).toBeInTheDocument();
    });

    // Submit the form (no changes)
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    await waitFor(() => {
      const secondCall = mockFetch.mock.calls[1];
      expect(secondCall[0]).toContain('page=1');
    });
  });

  // ---- Row expansion ----

  it('clicking a row expands the details JSON', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult()));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Admin (#7)')).toBeInTheDocument();
    });

    // The data row has aria-expanded attribute
    const dataRow = screen.getByRole('button', { expanded: false });
    fireEvent.click(dataRow);

    await waitFor(() => {
      // JSON should appear in a <pre>
      const pre = document.querySelector('pre');
      expect(pre).not.toBeNull();
      expect(pre!.textContent).toContain('bob@students.org');
    });
  });

  it('clicking an expanded row collapses the details', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult()));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('Alice Admin (#7)')).toBeInTheDocument();
    });

    // Expand
    const dataRow = screen.getByRole('button', { expanded: false });
    fireEvent.click(dataRow);

    await waitFor(() => {
      expect(document.querySelector('pre')).not.toBeNull();
    });

    // Collapse — row is now expanded=true
    const expandedRow = screen.getByRole('button', { expanded: true });
    fireEvent.click(expandedRow);

    await waitFor(() => {
      expect(document.querySelector('pre')).toBeNull();
    });
  });

  // ---- Pagination ----

  it('renders pagination controls with page info', async () => {
    // 60 total records, page 1, pageSize 50 → 2 pages
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(makeResult({ total: 60, page: 1 })),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /previous page/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeInTheDocument();
  });

  it('Previous button is disabled on page 1', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(makeResult({ total: 60 })));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    });
  });

  it('Next button is disabled on the last page', async () => {
    // 1 event total → 1 page
    vi.stubGlobal('fetch', mockFetchOnce(makeResult({ total: 1 })));

    renderPanel();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
    });
  });

  it('clicking Next fetches page 2', async () => {
    const event2 = makeEvent({ id: 2, actorName: 'Dave', actorId: 5 });

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResult({ total: 60, page: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => makeResult({ total: 60, page: 2, items: [event2] }),
      });

    vi.stubGlobal('fetch', mockFetch);

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));

    await waitFor(() => {
      expect(screen.getByText('Dave (#5)')).toBeInTheDocument();
    });

    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[0]).toContain('page=2');
  });
});
