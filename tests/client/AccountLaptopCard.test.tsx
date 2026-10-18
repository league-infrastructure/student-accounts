/**
 * Tests for AccountLaptopCard (sprint 002 "laptop accounts" T006, SUC-006).
 *
 * Covers:
 *  - the title and one line per state: ready (username shown, "Other..."),
 *    needs_password, invalid_username (with and without a username),
 *    disabled
 *  - the next-step link targets the Username & Password fields when the
 *    account has credentials, and opens the Add username/password flow when
 *    it does not
 *  - the "Syncing to laptops…" note appears only when dirty
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountLaptopCard, { type LaptopLoginState } from '../../client/src/pages/account/AccountLaptopCard';

function laptop(overrides: Partial<LaptopLoginState> = {}): LaptopLoginState {
  return { enabled: true, state: 'ready', username: 'alice', dirty: false, ...overrides };
}

function renderCard(state: LaptopLoginState, hasCredentials = true, onAdd = vi.fn()) {
  render(<AccountLaptopCard laptop={state} hasCredentials={hasCredentials} onAddCredentials={onAdd} />);
  return onAdd;
}

describe('AccountLaptopCard — states', () => {
  it('ready: shows the username and the Other... instruction', () => {
    renderCard(laptop());
    expect(screen.getByRole('heading', { name: 'Laptop login' })).toBeInTheDocument();
    expect(screen.getByTestId('laptop-login-state')).toHaveAttribute('data-state', 'ready');
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByTestId('laptop-login-state')).toHaveTextContent(
      'At the login screen on a League laptop choose Other... and use username alice and your password.',
    );
  });

  it('needs_password: tells the student to set a password and links to the password field', () => {
    renderCard(laptop({ enabled: false, state: 'needs_password' }));
    expect(screen.getByText(/Set a password to log in on League laptops/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set a password' })).toHaveAttribute('href', '#ups-new-password');
  });

  it('invalid_username: explains the rules and links to the username field', () => {
    renderCard(laptop({ enabled: false, state: 'invalid_username', username: 'Alice' }));
    expect(
      screen.getByText(/This username can't be used on laptops\. Change it to 3-32 lowercase letters, digits or dashes\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change username' })).toHaveAttribute('href', '#ups-username');
  });

  it('invalid_username with no username at all: asks for one', () => {
    renderCard(laptop({ enabled: false, state: 'invalid_username', username: null }));
    expect(screen.getByText(/You need a username to log in on League laptops/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a username' })).toHaveAttribute('href', '#ups-username');
  });

  it('disabled: account deactivated, ask an instructor', () => {
    renderCard(laptop({ enabled: false, state: 'disabled' }));
    expect(
      screen.getByText('This account is deactivated, so laptop login is locked. Ask an instructor.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('AccountLaptopCard — next step without credentials', () => {
  it('needs_password opens the Add username/password flow instead of linking', () => {
    const onAdd = renderCard(laptop({ enabled: false, state: 'needs_password', username: null }), false);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add username/password' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('invalid_username opens the Add username/password flow instead of linking', () => {
    const onAdd = renderCard(laptop({ enabled: false, state: 'invalid_username', username: null }), false);
    fireEvent.click(screen.getByRole('button', { name: 'Add username/password' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('AccountLaptopCard — syncing note', () => {
  it('shows "Syncing to laptops…" only when dirty', () => {
    const { unmount } = render(
      <AccountLaptopCard laptop={laptop({ dirty: true })} hasCredentials onAddCredentials={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Syncing to laptops…');
    unmount();

    renderCard(laptop({ dirty: false }));
    expect(screen.queryByTestId('laptop-login-syncing')).not.toBeInTheDocument();
  });

  it('is shown alongside non-ready states too', () => {
    renderCard(laptop({ enabled: false, state: 'disabled', dirty: true }));
    expect(screen.getByTestId('laptop-login-syncing')).toBeInTheDocument();
  });
});
