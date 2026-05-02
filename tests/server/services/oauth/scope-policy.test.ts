/**
 * Unit tests for ScopePolicy (Sprint 023 ticket 001).
 *
 * Pure module — no DB, no imports beyond the policy itself.
 */
import { describe, it, expect } from 'vitest';
import { ScopePolicy } from '../../../../server/src/services/oauth/scope-policy.js';
import { ForbiddenError } from '../../../../server/src/errors.js';

describe('ScopePolicy.allowedScopesFor', () => {
  it('student may only request profile', () => {
    expect(ScopePolicy.allowedScopesFor('student')).toEqual(['profile']);
  });

  it('staff may request profile and users:read', () => {
    expect(ScopePolicy.allowedScopesFor('staff')).toContain('profile');
    expect(ScopePolicy.allowedScopesFor('staff')).toContain('users:read');
  });

  it('admin may request profile and users:read', () => {
    expect(ScopePolicy.allowedScopesFor('admin')).toContain('profile');
    expect(ScopePolicy.allowedScopesFor('admin')).toContain('users:read');
  });

  it('unknown role returns empty array (fail-safe)', () => {
    expect(ScopePolicy.allowedScopesFor('superuser')).toEqual([]);
  });
});

describe('ScopePolicy.assertAllowed', () => {
  it('passes when student requests only profile', () => {
    expect(() => ScopePolicy.assertAllowed('student', ['profile'])).not.toThrow();
  });

  it('passes when student requests empty scopes', () => {
    expect(() => ScopePolicy.assertAllowed('student', [])).not.toThrow();
  });

  it('throws ForbiddenError when student requests users:read', () => {
    expect(() => ScopePolicy.assertAllowed('student', ['users:read'])).toThrow(ForbiddenError);
  });

  it('throws ForbiddenError when student requests profile + users:read', () => {
    expect(() => ScopePolicy.assertAllowed('student', ['profile', 'users:read'])).toThrow(ForbiddenError);
  });

  it('passes when staff requests profile + users:read', () => {
    expect(() => ScopePolicy.assertAllowed('staff', ['profile', 'users:read'])).not.toThrow();
  });

  it('passes when admin requests profile + users:read', () => {
    expect(() => ScopePolicy.assertAllowed('admin', ['profile', 'users:read'])).not.toThrow();
  });

  it('error message names the forbidden scope(s)', () => {
    try {
      ScopePolicy.assertAllowed('student', ['users:read']);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('users:read');
    }
  });
});
