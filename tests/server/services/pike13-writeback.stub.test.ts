/**
 * Basic contract tests for the pike13 write-back module-level exports.
 *
 * These tests verify the no-throw contract that existed in the old stub
 * and must remain stable in the real service:
 *  - leagueEmail resolves without throwing (no pike13 ExternalAccount exists
 *    in the test DB, so both calls are no-ops).
 *  - githubHandle resolves without throwing.
 *
 * Full integration tests covering API calls and audit events are in
 * tests/server/services/pike13/pike13-writeback.service.test.ts.
 */

import {
  leagueEmail,
  githubHandle,
} from '../../../server/src/services/pike13/pike13-writeback.service.js';

describe('pike13-writeback service — leagueEmail (no-op: no pike13 account)', () => {
  it('resolves without throwing for a valid userId and email', async () => {
    // userId 999999 has no pike13 ExternalAccount in the DB — no-op path
    await expect(leagueEmail(999999, 'student@jointheleague.org')).resolves.toBeUndefined();
  });

  it('returns undefined (no value produced)', async () => {
    const result = await leagueEmail(1, 'a@jointheleague.org');
    expect(result).toBeUndefined();
  });
});

describe('pike13-writeback service — githubHandle (no-op: no pike13 account)', () => {
  it('resolves without throwing for a valid userId and handle', async () => {
    await expect(githubHandle(999999, 'octocat')).resolves.toBeUndefined();
  });

  it('returns undefined (no value produced)', async () => {
    const result = await githubHandle(1, 'someuser');
    expect(result).toBeUndefined();
  });
});
