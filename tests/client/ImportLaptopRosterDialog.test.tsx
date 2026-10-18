/**
 * Tests for ImportLaptopRosterDialog (sprint 002 "laptop accounts" T003).
 *
 * Covers:
 *  - Renders nothing when closed
 *  - Open: title, explanation, group name prefilled "Botball 26", Run/Cancel
 *  - Run posts { groupName } to /api/admin/import/laptop-roster
 *  - Report rendered: counts, collapsible details, merge-queue link when created > 0
 *  - No merge-queue link when created == 0
 *  - Server error (503) shown as an alert, form stays usable
 *  - Blank group name is refused client-side
 *  - Cancel calls onClose; onImported receives the report
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ImportLaptopRosterDialog, {
  type ImportReport,
} from '../../client/src/pages/admin/ImportLaptopRosterDialog';

const REPORT: ImportReport = {
  created: 2,
  matched: 1,
  skipped: 1,
  errors: 0,
  details: [
    { id: 'alice', outcome: 'matched' },
    { id: 'bob', outcome: 'created' },
    { id: 'carol', outcome: 'created', reason: 'no usable hash' },
    { id: 'root', outcome: 'skipped', reason: 'reserved id' },
  ],
};

function mockFetchOk(report: ImportReport) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => report });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderDialog(props: Partial<React.ComponentProps<typeof ImportLaptopRosterDialog>> = {}) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  const utils = render(
    <MemoryRouter>
      <ImportLaptopRosterDialog open onClose={onClose} onImported={onImported} {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onClose, onImported };
}

describe('ImportLaptopRosterDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders nothing when closed', () => {
    render(
      <MemoryRouter>
        <ImportLaptopRosterDialog open={false} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens with explanation, group name prefilled "Botball 26", Run and Cancel', () => {
    mockFetchOk(REPORT);
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Import laptop roster' })).toBeInTheDocument();
    expect(within(dialog).getByText(/Creates an account here for every student/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Group name')).toHaveValue('Botball 26');
    expect(within(dialog).getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Run posts the group name and renders the report with counts, details and merge-queue link', async () => {
    const fetchMock = mockFetchOk(REPORT);
    const { onImported } = renderDialog();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Botball 27' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByTestId('import-created')).toHaveTextContent('2'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/import/laptop-roster');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ groupName: 'Botball 27' });

    expect(screen.getByTestId('import-matched')).toHaveTextContent('1');
    expect(screen.getByTestId('import-skipped')).toHaveTextContent('1');
    expect(screen.getByTestId('import-errors')).toHaveTextContent('0');
    expect(screen.getByText('Botball 27')).toBeInTheDocument();

    // Collapsible details list.
    const summary = screen.getByText('Details (4)');
    expect(summary.tagName).toBe('SUMMARY');
    expect(screen.getByText('root')).toBeInTheDocument();
    expect(screen.getByText(/reserved id/)).toBeInTheDocument();
    expect(screen.getByText(/no usable hash/)).toBeInTheDocument();

    // Merge queue link because created > 0.
    expect(screen.getByRole('link', { name: 'Review the merge queue' })).toHaveAttribute(
      'href',
      '/merge-queue',
    );

    expect(onImported).toHaveBeenCalledWith(REPORT);

    // The form is gone; only Close remains.
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('does not show the merge-queue link when nothing was created', async () => {
    mockFetchOk({ created: 0, matched: 3, skipped: 0, errors: 0, details: [] });
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByTestId('import-matched')).toHaveTextContent('3'));

    expect(screen.queryByRole('link', { name: 'Review the merge queue' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Details/)).not.toBeInTheDocument();
  });

  it('shows the server error message and keeps the form', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Laptop roster is not configured: set DO_SPACES_KEY' }),
      }),
    );
    const { onImported } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/not configured/),
    );
    expect(screen.getByRole('button', { name: 'Run' })).not.toBeDisabled();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('refuses a blank group name without calling the server', async () => {
    const fetchMock = mockFetchOk(REPORT);
    renderDialog();

    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/must not be blank/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Cancel calls onClose', () => {
    mockFetchOk(REPORT);
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
