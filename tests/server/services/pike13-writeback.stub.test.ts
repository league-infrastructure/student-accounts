/**
 * Unit tests for pike13-writeback.stub (Sprint 004 T003).
 *
 * Verifies the no-op behaviour required by UC-005 / UC-020:
 *  - leagueEmail resolves without throwing.
 *  - githubHandle resolves without throwing.
 *
 * Sprint 006 will replace the stub implementation at the same import path.
 * These tests verify only the contract that must be stable across that swap.
 */

import {
  leagueEmail,
  githubHandle,
} from '../../../server/src/services/pike13-writeback.stub.js';

describe('pike13-writeback stub — leagueEmail', () => {
  it('resolves without throwing for a valid userId and email', async () => {
    await expect(leagueEmail(42, 'student@jointheleague.org')).resolves.toBeUndefined();
  });

  it('returns undefined (no-op — no value produced)', async () => {
    const result = await leagueEmail(1, 'a@jointheleague.org');
    expect(result).toBeUndefined();
  });
});

describe('pike13-writeback stub — githubHandle', () => {
  it('resolves without throwing for a valid userId and handle', async () => {
    await expect(githubHandle(42, 'octocat')).resolves.toBeUndefined();
  });

  it('returns undefined (no-op — no value produced)', async () => {
    const result = await githubHandle(1, 'someuser');
    expect(result).toBeUndefined();
  });
});
