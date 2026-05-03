/**
 * Unit/integration tests for GroupService.userPermissions (Sprint 027 T002).
 *
 * After Sprint 027 T001 the three permission flags moved from Group to User.
 * userPermissions now does a single prisma.user.findUnique lookup — no group
 * join or additive union. Tests set the flags directly on the User row.
 *
 * The three permission columns on User are:
 *   allows_oauth_client   → oauthClient
 *   allows_llm_proxy      → llmProxy
 *   allows_league_account → leagueAccount
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { GroupService } from '../../../server/src/services/group.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { makeUser } from '../helpers/factories.js';

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
// userPermissions — reads directly from User row
// ---------------------------------------------------------------------------

describe('GroupService.userPermissions', () => {
  it('returns all false when user has all flags at default (false)', async () => {
    const u = await makeUser();

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('returns oauthClient true when User.allows_oauth_client=true', async () => {
    const u = await makeUser({ allows_oauth_client: true });

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(true);
    expect(perms.llmProxy).toBe(false);
    expect(perms.leagueAccount).toBe(false);
  });

  it('returns llmProxy true when User.allows_llm_proxy=true', async () => {
    const u = await makeUser({ allows_llm_proxy: true });

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(false);
    expect(perms.llmProxy).toBe(true);
    expect(perms.leagueAccount).toBe(false);
  });

  it('returns leagueAccount true when User.allows_league_account=true', async () => {
    const u = await makeUser({ allows_league_account: true });

    const perms = await service.userPermissions(u.id);

    expect(perms.oauthClient).toBe(false);
    expect(perms.llmProxy).toBe(false);
    expect(perms.leagueAccount).toBe(true);
  });

  it('returns all three true when all flags are set on User', async () => {
    const u = await makeUser({
      allows_oauth_client: true,
      allows_llm_proxy: true,
      allows_league_account: true,
    });

    const perms = await service.userPermissions(u.id);

    expect(perms).toEqual({
      oauthClient: true,
      llmProxy: true,
      leagueAccount: true,
    });
  });

  it('returns all false for a non-existent user id', async () => {
    const perms = await service.userPermissions(999999);

    expect(perms).toEqual({
      oauthClient: false,
      llmProxy: false,
      leagueAccount: false,
    });
  });

  it('two users with different flags are isolated from each other', async () => {
    const u1 = await makeUser({ allows_llm_proxy: true });
    const u2 = await makeUser({ allows_oauth_client: true });

    const p1 = await service.userPermissions(u1.id);
    const p2 = await service.userPermissions(u2.id);

    expect(p1.llmProxy).toBe(true);
    expect(p1.oauthClient).toBe(false);

    expect(p2.oauthClient).toBe(true);
    expect(p2.llmProxy).toBe(false);
  });
});
