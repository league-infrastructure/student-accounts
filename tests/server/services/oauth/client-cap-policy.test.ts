/**
 * Unit tests for ClientCapPolicy (Sprint 023 ticket 002).
 *
 * Pure module — no DB, no imports beyond the policy itself.
 */
import { describe, it, expect } from 'vitest';
import { ClientCapPolicy, ClientCapReachedError } from '../../../../server/src/services/oauth/client-cap-policy.js';

describe('ClientCapPolicy.maxClientsFor', () => {
  it('student cap is 1', () => {
    expect(ClientCapPolicy.maxClientsFor('student')).toBe(1);
  });

  it('staff cap is null (unlimited)', () => {
    expect(ClientCapPolicy.maxClientsFor('staff')).toBeNull();
  });

  it('admin cap is null (unlimited)', () => {
    expect(ClientCapPolicy.maxClientsFor('admin')).toBeNull();
  });

  it('unknown role returns 0 (fail-safe)', () => {
    expect(ClientCapPolicy.maxClientsFor('superuser')).toBe(0);
  });
});

describe('ClientCapPolicy.assertUnderCap', () => {
  it('student with 0 clients passes', () => {
    expect(() => ClientCapPolicy.assertUnderCap('student', 0)).not.toThrow();
  });

  it('student with 1 client throws ClientCapReachedError', () => {
    expect(() => ClientCapPolicy.assertUnderCap('student', 1)).toThrow(ClientCapReachedError);
  });

  it('student with 2 clients throws ClientCapReachedError', () => {
    expect(() => ClientCapPolicy.assertUnderCap('student', 2)).toThrow(ClientCapReachedError);
  });

  it('staff with 100 clients passes (unlimited)', () => {
    expect(() => ClientCapPolicy.assertUnderCap('staff', 100)).not.toThrow();
  });

  it('admin with 100 clients passes (unlimited)', () => {
    expect(() => ClientCapPolicy.assertUnderCap('admin', 100)).not.toThrow();
  });

  it('ClientCapReachedError has code CLIENT_CAP_REACHED', () => {
    try {
      ClientCapPolicy.assertUnderCap('student', 1);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('CLIENT_CAP_REACHED');
    }
  });

  it('error is a ForbiddenError (HTTP 403)', () => {
    try {
      ClientCapPolicy.assertUnderCap('student', 1);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
    }
  });
});
