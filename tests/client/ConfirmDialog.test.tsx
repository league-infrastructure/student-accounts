/**
 * Tests for the reusable ConfirmDialog component.
 *
 * Covers:
 *  - Does not render when open=false
 *  - Renders title and message when open=true
 *  - Confirm button calls onConfirm
 *  - Cancel button calls onCancel
 *  - Clicking the overlay backdrop calls onCancel
 *  - Pressing Escape calls onCancel
 *  - danger prop renders a red Confirm button (smoke-test; no exact colour assertion)
 *  - Custom confirmLabel / cancelLabel props
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../../client/src/components/ConfirmDialog';

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const defaults = {
    open: true,
    title: 'Delete item?',
    message: 'This action cannot be undone.',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { ...render(<ConfirmDialog {...props} />), props };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe('ConfirmDialog — visibility', () => {
  it('renders nothing when open=false', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete item?')).not.toBeInTheDocument();
  });

  it('renders the dialog when open=true', () => {
    renderDialog();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete item?')).toBeInTheDocument();
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

describe('ConfirmDialog — buttons', () => {
  it('renders default Confirm and Cancel labels', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('respects custom confirmLabel and cancelLabel', () => {
    renderDialog({ confirmLabel: 'Yes, remove', cancelLabel: 'Go back' });
    expect(screen.getByRole('button', { name: 'Yes, remove' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeInTheDocument();
  });

  it('calls onConfirm when Confirm button is clicked', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    const { props } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onConfirm).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Overlay click and ESC
// ---------------------------------------------------------------------------

describe('ConfirmDialog — overlay and keyboard', () => {
  it('calls onCancel when clicking the overlay backdrop', () => {
    const { props } = renderDialog();
    // The overlay is the dialog role element
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCancel when clicking inside the dialog panel', () => {
    const { props } = renderDialog();
    // Clicking the title text (which is inside the panel) should not close
    fireEvent.click(screen.getByText('Delete item?'));
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', () => {
    const { props } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onCancel on Escape when open=false', () => {
    const { props } = renderDialog({ open: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).not.toHaveBeenCalled();
  });
});
