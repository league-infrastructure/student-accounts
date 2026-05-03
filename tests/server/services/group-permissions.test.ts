/**
 * Unit/integration tests for GroupService.userPermissions (Sprint 026 T002).
 *
 * Uses a real SQLite test database via the shared Prisma client. Each test
 * resets the relevant tables so tests are fully isolated.
 *
 * The three permission flags on Group are:
 *   allows_oauth_client   → oauthClient
 *   allows_llm_proxy      → llmProxy
 *   allows_league_account → leagueAccount
 *
 * Additive union rule: a user gets a permission if ANY of their groups has
 * the flag set. A user in zero groups gets all three false.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { GroupService } from '../../../server/src/services/group.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { makeUser, makeGroup, makeMembership } from '../helpers/factories.js';

const audit = new AuditService();
const service = new GroupService(prisma, audit);

async function resetDb() {
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// userPermissions
// ---------------------------------------------------------------------------

describe('GroupService.userPermissions', () => {
  it('returns all false when user has no group memberships', async () => {
    const u = await makeUser();

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('returns all false when user is in one group with all flags off', async () => {
    const u = await makeUser();
    const g = await makeGroup();
    // Flags default to false — no override needed.
    await makeMembership(g, u);

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('returns oauthClient true when one group has allows_oauth_client=true', async () => {
    const u = await makeUser();
    const g = await (prisma as any).group.create({
      data: {
        name: `oauth-group-${Date.now()}`,
        allows_oauth_client: true,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    await makeMembership(g, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(true);
    expect(perms.llmProxy).toBe(false);
    expect(perms.leagueAccount).toBe(false);
  });

  it('returns llmProxy true when one group has allows_llm_proxy=true', async () => {
    const u = await makeUser();
    const g = await (prisma as any).group.create({
      data: {
        name: `llm-group-${Date.now()}`,
        allows_oauth_client: false,
        allows_llm_proxy: true,
        allows_league_account: false,
      },
    });
    await makeMembership(g, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(false);
    expect(perms.llmProxy).toBe(true);
    expect(perms.leagueAccount).toBe(false);
  });

  it('returns leagueAccount true when one group has allows_league_account=true', async () => {
    const u = await makeUser();
    const g = await (prisma as any).group.create({
      data: {
        name: `league-group-${Date.now()}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: true,
      },
    });
    await makeMembership(g, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(false);
    expect(perms.llmProxy).toBe(false);
    expect(perms.leagueAccount).toBe(true);
  });

  it('returns llmProxy true when user is in two groups and only one has allows_llm_proxy=true', async () => {
    const u = await makeUser();
    const ts = Date.now();
    const g1 = await (prisma as any).group.create({
      data: {
        name: `g1-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    const g2 = await (prisma as any).group.create({
      data: {
        name: `g2-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: true,
        allows_league_account: false,
      },
    });
    await makeMembership(g1, u);
    await makeMembership(g2, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(false);
    expect(perms.llmProxy).toBe(true);
    expect(perms.leagueAccount).toBe(false);
  });

  it('returns leagueAccount false when user is in two groups and both have allows_league_account=false', async () => {
    const u = await makeUser();
    const ts = Date.now();
    const g1 = await (prisma as any).group.create({
      data: {
        name: `g1b-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    const g2 = await (prisma as any).group.create({
      data: {
        name: `g2b-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    await makeMembership(g1, u);
    await makeMembership(g2, u);

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('returns the correct union when two groups each have a different permission', async () => {
    const u = await makeUser();
    const ts = Date.now();
    // Group A grants oauthClient; Group B grants leagueAccount.
    const gA = await (prisma as any).group.create({
      data: {
        name: `gA-${ts}`,
        allows_oauth_client: true,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    const gB = await (prisma as any).group.create({
      data: {
        name: `gB-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: true,
      },
    });
    await makeMembership(gA, u);
    await makeMembership(gB, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(true);
    expect(perms.llmProxy).toBe(false);
    expect(perms.leagueAccount).toBe(true);
  });

  it('returns all three true when groups collectively grant all permissions', async () => {
    const u = await makeUser();
    const ts = Date.now();
    const gOauth = await (prisma as any).group.create({
      data: {
        name: `gOauth-${ts}`,
        allows_oauth_client: true,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    const gLlm = await (prisma as any).group.create({
      data: {
        name: `gLlm-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: true,
        allows_league_account: false,
      },
    });
    const gLeague = await (prisma as any).group.create({
      data: {
        name: `gLeague-${ts}`,
        allows_oauth_client: false,
        allows_llm_proxy: false,
        allows_league_account: true,
      },
    });
    await makeMembership(gOauth, u);
    await makeMembership(gLlm, u);
    await makeMembership(gLeague, u);

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: true,
      llmProxy: true,
      leagueAccount: true,
    });
  });

  it('returns all false for a non-existent (or deleted) user id', async () => {
    // A user ID that has no rows in the database returns all false
    // (findMany returns an empty array, some() on empty is false).
    const perms = await service.userPermissions(999999);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('is idempotent — two groups with the same flag both true still returns true once', async () => {
    const u = await makeUser();
    const ts = Date.now();
    const g1 = await (prisma as any).group.create({
      data: {
        name: `g1idem-${ts}`,
        allows_oauth_client: true,
        allows_llm_proxy: true,
        allows_league_account: false,
      },
    });
    const g2 = await (prisma as any).group.create({
      data: {
        name: `g2idem-${ts}`,
        allows_oauth_client: true,
        allows_llm_proxy: false,
        allows_league_account: false,
      },
    });
    await makeMembership(g1, u);
    await makeMembership(g2, u);

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(true);
    expect(perms.llmProxy).toBe(true);
    expect(perms.leagueAccount).toBe(false);
  });
});
