/**
 * OAuth account-linking tests.
 *
 * The findOrCreateOAuthUser helper was removed in Sprint 018 ticket 004
 * when OAuth strategies (GitHub/Google/Pike13) were replaced with demo
 * login credentials. These tests are obsolete and replaced by
 * auth-demo-login.test.ts.
 */

describe('Account linking — OAuth removed', () => {
  it('findOrCreateOAuthUser has been removed; demo-login replaced OAuth', () => {
    // OAuth account linking is no longer part of this application.
    // See auth-demo-login.test.ts for the replacement login tests.
    expect(true).toBe(true);
  });
});
