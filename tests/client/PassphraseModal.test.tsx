/**
 * Tests for PassphraseModal (Sprint 015 T007).
 *
 * Covers:
 *   - Renders with a pre-filled passphrase suggestion on open.
 *   - Regenerate button changes the suggestion.
 *   - Editing the input is allowed.
 *   - LLM proxy checkbox toggles.
 *   - Submit POSTs to the correct URL for cohort scope.
 *   - Submit POSTs to the correct URL for group scope.
 *   - Server error is shown inline; modal does not close.
 *   - Successful create calls onCreated and onClose.
 *   - Cancel calls onClose without hitting the API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PassphraseModal } from '../../client/src/components/PassphraseModal';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const COHORT_SCOPE = { kind: 'cohort' as const, id: 5, name: 'Spring 2026' };
const GROUP_SCOPE = { kind: 'group' as const, id: 7, name: 'Alpha' };

const PASSPHRASE_RECORD = {
  plaintext: 'test-pass-phrase',
  expiresAt: '2026-04-26T00:00:00.000Z',
  grantLlmProxy: false,
  createdAt: '2026-04-25T00:00:00.000Z',
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderModal(props: {
  isOpen?: boolean;
  scope?: typeof COHORT_SCOPE | typeof GROUP_SCOPE;
  onClose?: () => void;
  onCreated?: (r: typeof PASSPHRASE_RECORD) => void;
}) {
  const {
    isOpen = true,
    scope = COHORT_SCOPE,
    onClose = vi.fn(),
    onCreated = vi.fn(),
  } = props;
  const client = makeClient();
  return {
    onClose,
    onCreated,
    ...render(
      <QueryClientProvider client={client}>
        <PassphraseModal isOpen={isOpen} scope={scope} onClose={onClose} onCreated={onCreated} />
      </QueryClientProvider>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Render and generated suggestion
// ---------------------------------------------------------------------------

describe('PassphraseModal — open state', () => {
  it('renders the modal when isOpen is true', () => {
    renderModal({});
    expect(screen.getByText(/create passphrase/i)).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText(/create passphrase/i)).toBeNull();
  });

  it('shows the scope name', () => {
    renderModal({ scope: COHORT_SCOPE });
    expect(screen.getByText('Spring 2026')).toBeInTheDocument();
  });

  it('opens with a non-empty passphrase suggestion in the input', () => {
    renderModal({});
    const input = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
    expect(input.value.length).toBeGreaterThan(0);
  });

  it('generated suggestion looks like three hyphen-separated words', () => {
    renderModal({});
    const input = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
    const parts = input.value.split('-');
    expect(parts.length).toBe(3);
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });
});

// ---------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------

describe('PassphraseModal — Regenerate button', () => {
  it('changes the passphrase suggestion when clicked', async () => {
    // Mock Math.random to return different values on successive calls
    let callCount = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      // First 3 calls (initial render): return index 0 words
      // Next 3 calls (regenerate): return index 5 words
      callCount++;
      return callCount <= 3 ? 0 : 0.05;
    });

    renderModal({});
    const input = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
    const before = input.value;

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    // Value should change (different Math.random sequence)
    const after = input.value;
    // Both should be 3-word phrases
    expect(after.split('-').length).toBe(3);
    // With our mock they'll differ since we changed Math.random results
    expect(before).not.toBe(after);
  });
});

// ---------------------------------------------------------------------------
// Editing input
// ---------------------------------------------------------------------------

describe('PassphraseModal — input editing', () => {
  it('allows the admin to edit the passphrase', () => {
    renderModal({});
    const input = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'my-custom-phrase' } });
    expect(input.value).toBe('my-custom-phrase');
  });
});

// ---------------------------------------------------------------------------
// LLM proxy checkbox
// ---------------------------------------------------------------------------

describe('PassphraseModal — LLM proxy checkbox', () => {
  it('is unchecked by default', () => {
    renderModal({});
    const checkbox = screen.getByLabelText(/llm proxy/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('toggles when clicked', () => {
    renderModal({});
    const checkbox = screen.getByLabelText(/llm proxy/i) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

describe('PassphraseModal — Cancel', () => {
  it('calls onClose without calling fetch', () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;

    const { onClose } = renderModal({});
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Submit — cohort scope
// ---------------------------------------------------------------------------

describe('PassphraseModal — submit (cohort)', () => {
  it('POSTs to /api/admin/cohorts/:id/passphrase with plaintext and grantLlmProxy', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, PASSPHRASE_RECORD));
    globalThis.fetch = fetchMock as any;

    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ scope: COHORT_SCOPE, onCreated, onClose });

    const input = screen.getByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'spring-class-fun' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/cohorts/5/passphrase');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.plaintext).toBe('spring-class-fun');
    expect(body.grantLlmProxy).toBe(false);
  });

  it('includes grantLlmProxy: true when checkbox is checked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(201, { ...PASSPHRASE_RECORD, grantLlmProxy: true }),
    );
    globalThis.fetch = fetchMock as any;

    renderModal({ scope: COHORT_SCOPE });

    const checkbox = screen.getByLabelText(/llm proxy/i);
    fireEvent.click(checkbox);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.grantLlmProxy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Submit — group scope
// ---------------------------------------------------------------------------

describe('PassphraseModal — submit (group)', () => {
  it('POSTs to /api/admin/groups/:id/passphrase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, PASSPHRASE_RECORD));
    globalThis.fetch = fetchMock as any;

    renderModal({ scope: GROUP_SCOPE });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/groups/7/passphrase');
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe('PassphraseModal — success', () => {
  it('calls onCreated with the result and onClose on 201', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, PASSPHRASE_RECORD));
    globalThis.fetch = fetchMock as any;

    const onCreated = vi.fn();
    const onClose = vi.fn();
    renderModal({ onCreated, onClose });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledWith(PASSPHRASE_RECORD);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Error path
// ---------------------------------------------------------------------------

describe('PassphraseModal — server error', () => {
  it('shows inline error and does not close on 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: 'Passphrase already active.' }),
    );
    globalThis.fetch = fetchMock as any;

    const onClose = vi.fn();
    renderModal({ onClose });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/passphrase already active/i)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a generic error message when server returns no body.error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    globalThis.fetch = fetchMock as any;

    renderModal({});

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
    });

    await waitFor(() =>
      expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument(),
    );
  });
});
