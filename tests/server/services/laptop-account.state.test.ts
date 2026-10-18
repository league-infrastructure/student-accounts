/**
 * Unit tests for LaptopAccountService.stateFor / laptopLoginState (sprint 002
 * "laptop accounts" T006, SUC-006 / SUC-007). Pure functions over a user row:
 * no database, no roster.
 *
 * Covers:
 *  - every state and the precedence between them (disabled >
 *    needs_password > invalid_username > ready)
 *  - `ready` is exactly `isEligible`
 *  - username / dirty / enabled are passed through; lastWritten is absent
 *  - the service method delegates to the module function
 */

import { describe, it, expect } from 'vitest';
import { AuditService } from '../../../server/src/services/audit.service.js';
import {
  LaptopAccountService,
  laptopLoginState,
  stateFor,
  type LaptopStateUser,
} from '../../../server/src/services/laptop/laptop-account.service.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

function user(overrides: Partial<LaptopStateUser> = {}): LaptopStateUser {
  return {
    id: 1,
    username: 'alice',
    display_name: 'Alice',
    laptop_password_hash: HASH,
    is_active: true,
    laptop_roster_dirty: false,
    ...overrides,
  };
}

describe('laptopLoginState', () => {
  it('is ready for an active student with a valid username and a crypt hash', () => {
    expect(laptopLoginState(user())).toBe('ready');
  });

  it('is ready for staff too', () => {
    expect(laptopLoginState(user({ role: 'staff' } as any))).toBe('ready');
  });

  it('ignores the retired allows_laptop_account flag', () => {
    expect(laptopLoginState(user({ allows_laptop_account: false } as any))).toBe('ready');
  });

  it('is disabled when the account is inactive', () => {
    expect(laptopLoginState(user({ is_active: false }))).toBe('disabled');
  });

  it('is ready for admins too: the login is just the username and password', () => {
    expect(laptopLoginState(user({ role: 'admin' } as any))).toBe('ready');
  });

  it('is needs_password without a laptop hash', () => {
    expect(laptopLoginState(user({ laptop_password_hash: null }))).toBe('needs_password');
  });

  it('is invalid_username for a missing, mixed-case, short or reserved username', () => {
    expect(laptopLoginState(user({ username: null }))).toBe('invalid_username');
    expect(laptopLoginState(user({ username: 'Alice' }))).toBe('invalid_username');
    expect(laptopLoginState(user({ username: 'ab' }))).toBe('invalid_username');
    expect(laptopLoginState(user({ username: 'student' }))).toBe('invalid_username');
    expect(laptopLoginState(user({ username: 'a.b' }))).toBe('invalid_username');
  });

  it('reports the first blocker: disabled beats needs_password beats invalid_username', () => {
    expect(laptopLoginState(user({ is_active: false, laptop_password_hash: null, username: 'X' }))).toBe('disabled');
    expect(laptopLoginState(user({ laptop_password_hash: null, username: 'X' }))).toBe('needs_password');
  });

  it('agrees with isEligible: ready iff eligible', () => {
    const service = new LaptopAccountService(new FakeLaptopRosterClient(), {} as any, new AuditService());
    const cases: LaptopStateUser[] = [
      user(),
      user({ role: 'staff' } as any),
      user({ role: 'admin' } as any),
      user({ is_active: false }),
      user({ laptop_password_hash: null }),
      user({ username: null }),
      user({ username: 'Alice' }),
      user({ username: 'alice-2' }),
    ];
    for (const u of cases) {
      expect(laptopLoginState(u) === 'ready', JSON.stringify(u)).toBe(service.isEligible(u));
    }
  });
});

describe('stateFor', () => {
  it('returns the view with enabled, state, username and dirty; no lastWritten', () => {
    expect(stateFor(user())).toEqual({ enabled: true, state: 'ready', username: 'alice', dirty: false });
    expect(stateFor(user({ laptop_roster_dirty: true }))).toEqual({
      enabled: true,
      state: 'ready',
      username: 'alice',
      dirty: true,
    });
  });

  it('enabled is false for every non-ready state and the username is passed through', () => {
    expect(stateFor(user({ laptop_password_hash: null }))).toEqual({
      enabled: false,
      state: 'needs_password',
      username: 'alice',
      dirty: false,
    });
    expect(stateFor(user({ username: null }))).toMatchObject({ enabled: false, state: 'invalid_username', username: null });
    expect(stateFor(user({ username: 'Alice' }))).toMatchObject({ state: 'invalid_username', username: 'Alice' });
    expect(stateFor(user({ is_active: false }))).toMatchObject({ enabled: false, state: 'disabled' });
    expect(stateFor(user({ role: 'admin' } as any))).toMatchObject({ enabled: true, state: 'ready' });
  });

  it('is exposed on the service and gives the same answer', () => {
    const service = new LaptopAccountService(new FakeLaptopRosterClient(), {} as any, new AuditService());
    const u = user({ username: 'Alice', laptop_roster_dirty: true });
    expect(service.stateFor(u)).toEqual(stateFor(u));
  });
});
