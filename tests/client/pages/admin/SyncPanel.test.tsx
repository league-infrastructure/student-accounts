/**
 * Tests for the Anthropic (Claude) section of SyncPanel (Sprint 010 T012).
 *
 * Covers:
 *  - Probe section auto-loads on mount; renders org user count and workspace names.
 *  - Probe failure shows error banner.
 *  - "Sync Claude accounts" button fires POST /api/admin/sync/claude.
 *  - SyncReport renders created/linked/invitedAccepted/removed/unmatched counts.
 *  - Unmatched emails render in a table with the suggestion text.
 *  - HTTP error from sync endpoint shows error banner.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SyncPanel from '../../../../client/src/pages/admin/SyncPanel';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const PROBE_OK = {
  ok: true,
  org: null,
  userCount: 42,
  workspaces: ['Students', 'Staff'],
  invitesCount: 3,
  writeEnabled: true,
};

const PROBE_FAIL = {
  ok: false,
  org: null,
  userCount: null,
  workspaces: [],
  invitesCount: null,
  writeEnabled: false,
  error: 'Anthropic API unavailable',
};

const SYNC_REPORT_EMPTY = {
  created: 0,
  linked: 0,
  invitedAccepted: 0,
  removed: 0,
  unmatched: [],
};

const SYNC_REPORT_WITH_UNMATCHED = {
  created: 2,
  linked: 2,
  invitedAccepted: 1,
  removed: 0,
  unmatched: ['nolocal@example.com', 'ghost@example.com'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fetch mock that:
 *  - returns probeResponse for GET /api/admin/anthropic/probe
 *  - returns syncResponse for POST /api/admin/sync/claude (if provided)
 *  - returns 200 OK for all other POST routes (Pike13, workspace) so the panel
 *    renders without errors from those sections
 */
function makeFetch(options: {
  probeResponse?: object;
  syncResponse?: object;
  syncOk?: boolean;
}) {
  const { probeResponse = PROBE_OK, syncResponse = SYNC_REPORT_EMPTY, syncOk = true } = options;

  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes('/api/admin/anthropic/probe')) {
      return Promise.resolve({
        ok: true,
        json: async () => probeResponse,
      });
    }
    if (url.includes('/api/admin/sync/claude') && init?.method === 'POST') {
      return Promise.resolve({
        ok: syncOk,
        json: async () => syncResponse,
      });
    }
    // Default: return 200 OK for other routes
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

function renderPanel(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  return render(<SyncPanel />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncPanel — Anthropic (Claude) section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Probe auto-load -------------------------------------------------------

  describe('Probe status card', () => {
    it('renders user count from probe result on mount', async () => {
      renderPanel(makeFetch({ probeResponse: PROBE_OK }));

      await waitFor(() => {
        expect(screen.getByText(/42/)).toBeInTheDocument();
      });
    });

    it('renders workspace names from probe result', async () => {
      renderPanel(makeFetch({ probeResponse: PROBE_OK }));

      await waitFor(() => {
        expect(screen.getByText(/Students.*Staff/)).toBeInTheDocument();
      });
    });

    it('renders pending invite count from probe result', async () => {
      renderPanel(makeFetch({ probeResponse: PROBE_OK }));

      await waitFor(() => {
        // The probe section renders "Pending invites: 3" as a labeled line.
        // Use a container query to scope to the probe result region.
        const probeRegion = screen.getByRole('region', { name: /anthropic probe result/i });
        expect(probeRegion.textContent).toContain('3');
      });
    });

    it('renders write-enabled status as Yes', async () => {
      renderPanel(makeFetch({ probeResponse: PROBE_OK }));

      await waitFor(() => {
        expect(screen.getByText('Yes')).toBeInTheDocument();
      });
    });

    it('shows error banner when probe returns ok:false', async () => {
      renderPanel(makeFetch({ probeResponse: PROBE_FAIL }));

      await waitFor(() => {
        const alert = screen.getByRole('alert', { name: /anthropic probe error/i });
        expect(alert).toBeInTheDocument();
        expect(alert.textContent).toContain('Anthropic API unavailable');
      });
    });

    it('calls GET /api/admin/anthropic/probe on mount', async () => {
      const fetchMock = makeFetch({ probeResponse: PROBE_OK });
      renderPanel(fetchMock);

      await waitFor(() => {
        const probeCalls = fetchMock.mock.calls.filter(
          (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('/api/admin/anthropic/probe'),
        );
        expect(probeCalls.length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  // ---- Sync button -----------------------------------------------------------

  describe('Sync Claude accounts button', () => {
    it('renders the sync button', async () => {
      renderPanel(makeFetch({}));

      // The button is rendered immediately (not gated on probe)
      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      expect(btn).toBeInTheDocument();
    });

    it('posts to /api/admin/sync/claude when clicked', async () => {
      const fetchMock = makeFetch({ syncResponse: SYNC_REPORT_EMPTY });
      renderPanel(fetchMock);

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        const syncCalls = fetchMock.mock.calls.filter(
          (call: unknown[]) =>
            typeof call[0] === 'string' &&
            (call[0] as string).includes('/api/admin/sync/claude') &&
            (call[1] as RequestInit | undefined)?.method === 'POST',
        );
        expect(syncCalls.length).toBeGreaterThanOrEqual(1);
      });
    });

    it('renders SyncReport counts after successful sync', async () => {
      renderPanel(makeFetch({ syncResponse: SYNC_REPORT_EMPTY }));

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        const resultRegion = screen.getByRole('region', { name: /anthropic sync result/i });
        expect(resultRegion).toBeInTheDocument();
      });
    });

    it('renders non-zero created count in SyncReport', async () => {
      renderPanel(makeFetch({ syncResponse: SYNC_REPORT_WITH_UNMATCHED }));

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        expect(screen.getByRole('region', { name: /anthropic sync result/i })).toBeInTheDocument();
      });

      // Created badge shows "2"
      const resultRegion = screen.getByRole('region', { name: /anthropic sync result/i });
      expect(resultRegion.textContent).toContain('2');
    });

    it('renders unmatched emails in a table', async () => {
      renderPanel(makeFetch({ syncResponse: SYNC_REPORT_WITH_UNMATCHED }));

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        expect(screen.getByText('nolocal@example.com')).toBeInTheDocument();
        expect(screen.getByText('ghost@example.com')).toBeInTheDocument();
      });
    });

    it('shows suggestion text in unmatched table', async () => {
      renderPanel(makeFetch({ syncResponse: SYNC_REPORT_WITH_UNMATCHED }));

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        // Scope to the sync result region to avoid matching the <strong> header above the table.
        const resultRegion = screen.getByRole('region', { name: /anthropic sync result/i });
        // querySelectorAll finds the suggestion <td> cells (not the heading <strong>).
        const suggestionCells = resultRegion.querySelectorAll('td');
        // Each unmatched row has 2 tds: email and suggestion. Count suggestion tds.
        const suggestionTds = Array.from(suggestionCells).filter((td) =>
          td.textContent?.match(/create a local user first/i),
        );
        expect(suggestionTds.length).toBe(SYNC_REPORT_WITH_UNMATCHED.unmatched.length);
      });
    });

    it('shows error banner when sync endpoint returns non-ok', async () => {
      renderPanel(
        makeFetch({
          syncOk: false,
          syncResponse: { error: 'Anthropic API unreachable' },
        }),
      );

      const btn = screen.getByRole('button', { name: /sync claude accounts/i });
      fireEvent.click(btn);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert.textContent).toContain('Anthropic API unreachable');
      });
    });
  });
});
