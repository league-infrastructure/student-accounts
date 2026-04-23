/**
 * Integration tests for GroupRepository (Sprint 012 T001).
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { GroupRepository } from '../../../server/src/services/repositories/group.repository.js';
import { makeGroup, makeMembership, makeUser, makeLogin } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
});

// ---------------------------------------------------------------------------
// create + findById / findByName
// ---------------------------------------------------------------------------

describe('GroupRepository.create', () => {
  it('inserts a group and returns the created row', async () => {
    const g = await GroupRepository.create(prisma, {
      name: 'Alpha Team',
      description: 'Top students',
    });
    expect(g.id).toBeGreaterThan(0);
    expect(g.name).toBe('Alpha Team');
    expect(g.description).toBe('Top students');
    expect(g.created_at).toBeInstanceOf(Date);
  });

  it('creates a group with null description', async () => {
    const g = await GroupRepository.create(prisma, { name: 'NoDesc' });
    expect(g.description).toBeNull();
  });
});

describe('GroupRepository.findById / findByName', () => {
  it('findById returns the group', async () => {
    const created = await makeGroup({ name: 'Find By Id' });
    const found = await GroupRepository.findById(prisma, created.id);
    expect(found?.name).toBe('Find By Id');
  });

  it('findById returns null when missing', async () => {
    expect(await GroupRepository.findById(prisma, 99999)).toBeNull();
  });

  it('findByName returns the group', async () => {
    await makeGroup({ name: 'By Name' });
    const found = await GroupRepository.findByName(prisma, 'By Name');
    expect(found?.name).toBe('By Name');
  });

  it('findByName returns null when missing', async () => {
    expect(await GroupRepository.findByName(prisma, 'none')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllWithMemberCount
// ---------------------------------------------------------------------------

describe('GroupRepository.findAllWithMemberCount', () => {
  it('returns counts that reflect UserGroup rows', async () => {
    const alice = await makeUser({ display_name: 'Alice' });
    const bob = await makeUser({ display_name: 'Bob' });
    const g1 = await makeGroup({ name: 'G1' });
    const g2 = await makeGroup({ name: 'G2' });
    await makeMembership(g1, alice);
    await makeMembership(g1, bob);

    const rows = await GroupRepository.findAllWithMemberCount(prisma);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.memberCount]));
    expect(byName['G1']).toBe(2);
    expect(byName['G2']).toBe(0);
  });

  it('returns groups ordered by name', async () => {
    await makeGroup({ name: 'Z' });
    await makeGroup({ name: 'A' });
    await makeGroup({ name: 'M' });
    const rows = await GroupRepository.findAllWithMemberCount(prisma);
    expect(rows.map((r) => r.name)).toEqual(['A', 'M', 'Z']);
  });
});

// ---------------------------------------------------------------------------
// update + delete
// ---------------------------------------------------------------------------

describe('GroupRepository.update / delete', () => {
  it('update writes new fields', async () => {
    const g = await makeGroup({ name: 'Before' });
    const updated = await GroupRepository.update(prisma, g.id, {
      name: 'After',
      description: 'changed',
    });
    expect(updated.name).toBe('After');
    expect(updated.description).toBe('changed');
  });

  it('delete removes the group', async () => {
    const g = await makeGroup({ name: 'To Delete' });
    await GroupRepository.delete(prisma, g.id);
    expect(await GroupRepository.findById(prisma, g.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unique constraint
// ---------------------------------------------------------------------------

describe('Group unique name constraint', () => {
  it('throws on duplicate name', async () => {
    await makeGroup({ name: 'Dup' });
    await expect(
      GroupRepository.create(prisma, { name: 'Dup' }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Membership CRUD
// ---------------------------------------------------------------------------

describe('GroupRepository membership CRUD', () => {
  it('addMember + isMember + removeMember roundtrip', async () => {
    const u = await makeUser({ display_name: 'Mem' });
    const g = await makeGroup({ name: 'G' });
    expect(await GroupRepository.isMember(prisma, g.id, u.id)).toBe(false);
    await GroupRepository.addMember(prisma, g.id, u.id);
    expect(await GroupRepository.isMember(prisma, g.id, u.id)).toBe(true);
    const removed = await GroupRepository.removeMember(prisma, g.id, u.id);
    expect(removed).toBe(true);
    expect(await GroupRepository.isMember(prisma, g.id, u.id)).toBe(false);
  });

  it('removeMember returns false when not a member', async () => {
    const u = await makeUser();
    const g = await makeGroup();
    expect(await GroupRepository.removeMember(prisma, g.id, u.id)).toBe(false);
  });

  it('addMember throws on duplicate (composite PK)', async () => {
    const u = await makeUser();
    const g = await makeGroup();
    await GroupRepository.addMember(prisma, g.id, u.id);
    await expect(
      GroupRepository.addMember(prisma, g.id, u.id),
    ).rejects.toThrow();
  });

  it('countMembers returns the current size', async () => {
    const g = await makeGroup();
    const a = await makeUser();
    const b = await makeUser();
    await makeMembership(g, a);
    await makeMembership(g, b);
    expect(await GroupRepository.countMembers(prisma, g.id)).toBe(2);
  });

  it('deleteMembershipsForGroup wipes rows for that group only', async () => {
    const g1 = await makeGroup();
    const g2 = await makeGroup();
    const u = await makeUser();
    await makeMembership(g1, u);
    await makeMembership(g2, u);
    const wiped = await GroupRepository.deleteMembershipsForGroup(prisma, g1.id);
    expect(wiped).toBe(1);
    expect(await GroupRepository.countMembers(prisma, g1.id)).toBe(0);
    expect(await GroupRepository.countMembers(prisma, g2.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// listMembers
// ---------------------------------------------------------------------------

describe('GroupRepository.listMembers', () => {
  it('returns members sorted by display_name', async () => {
    const g = await makeGroup();
    const zed = await makeUser({ display_name: 'Zed' });
    const ada = await makeUser({ display_name: 'Ada' });
    const mia = await makeUser({ display_name: 'Mia' });
    await makeMembership(g, zed);
    await makeMembership(g, ada);
    await makeMembership(g, mia);

    const rows = await GroupRepository.listMembers(prisma, g.id);
    expect(rows.map((r) => r.display_name)).toEqual(['Ada', 'Mia', 'Zed']);
  });

  it('excludes inactive users', async () => {
    const g = await makeGroup();
    const alice = await makeUser({ display_name: 'Alice' });
    const bob = await makeUser({ display_name: 'Bob' });
    await makeMembership(g, alice);
    await makeMembership(g, bob);
    await (prisma as any).user.update({
      where: { id: bob.id },
      data: { is_active: false },
    });

    const rows = await GroupRepository.listMembers(prisma, g.id);
    expect(rows.map((r) => r.display_name)).toEqual(['Alice']);
  });
});

// ---------------------------------------------------------------------------
// listGroupsForUser
// ---------------------------------------------------------------------------

describe('GroupRepository.listGroupsForUser', () => {
  it('returns groups sorted by name', async () => {
    const u = await makeUser();
    const z = await makeGroup({ name: 'Zed' });
    const a = await makeGroup({ name: 'Ada' });
    const m = await makeGroup({ name: 'Mia' });
    await makeMembership(a, u);
    await makeMembership(m, u);
    await makeMembership(z, u);

    const rows = await GroupRepository.listGroupsForUser(prisma, u.id);
    expect(rows.map((g) => g.name)).toEqual(['Ada', 'Mia', 'Zed']);
  });

  it('returns empty when user is in no groups', async () => {
    const u = await makeUser();
    expect(await GroupRepository.listGroupsForUser(prisma, u.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchUsersNotInGroup
// ---------------------------------------------------------------------------

describe('GroupRepository.searchUsersNotInGroup', () => {
  it('matches on display_name', async () => {
    const g = await makeGroup();
    const amy = await makeUser({
      display_name: 'AmyUniq',
      primary_email: 'aaaa@foo.io',
    });
    await makeUser({ display_name: 'Bob', primary_email: 'bbbb@foo.io' });

    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'amyuniq');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe(amy.id);
    expect(hits[0].matchedOn).toBe('display_name');
  });

  it('matches on primary_email', async () => {
    const g = await makeGroup();
    await makeUser({ display_name: 'Zed', primary_email: 'unique-needle@example.com' });

    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'needle');
    expect(hits.length).toBe(1);
    expect(hits[0].matchedOn).toBe('primary_email');
  });

  it('matches on Login.provider_email', async () => {
    const g = await makeGroup();
    const u = await makeUser({ display_name: 'Solo', primary_email: 'solo@foo.com' });
    await makeLogin(u, { provider_email: 'alt-handle@external.com' });

    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'alt-handle');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe(u.id);
    expect(hits[0].matchedOn).toBe('provider_email');
  });

  it('matches on Login.provider_username', async () => {
    const g = await makeGroup();
    const u = await makeUser({ display_name: 'Solo2', primary_email: 'solo2@foo.com' });
    await makeLogin(u, {
      provider: 'github',
      provider_user_id: 'gh_1',
      provider_email: null,
      provider_username: 'octocat-ninja' as any,
    } as any);

    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'ninja');
    expect(hits.length).toBe(1);
    expect(hits[0].matchedOn).toBe('provider_username');
  });

  it('excludes users already in the group', async () => {
    const g = await makeGroup();
    const alice = await makeUser({ display_name: 'Alice' });
    const bob = await makeUser({ display_name: 'Bob' });
    await makeMembership(g, alice);

    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'li');
    // Alice is already in the group; only non-members returned.
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain(alice.id);
    // Bob doesn't match 'li', so result should be empty.
    expect(hits.length).toBe(0);
    // Sanity: searching 'bo' should hit Bob.
    const hits2 = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'bo');
    expect(hits2.map((h) => h.id)).toEqual([bob.id]);
  });

  it('excludes inactive users', async () => {
    const g = await makeGroup();
    const u = await makeUser({ display_name: 'Ghost' });
    await (prisma as any).user.update({ where: { id: u.id }, data: { is_active: false } });
    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'ghost');
    expect(hits).toEqual([]);
  });

  it('respects the limit argument', async () => {
    const g = await makeGroup();
    for (let i = 0; i < 5; i++) {
      await makeUser({ display_name: `Limit ${i}` });
    }
    const hits = await GroupRepository.searchUsersNotInGroup(prisma, g.id, 'Limit', 2);
    expect(hits.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cascade delete — deleting a user should drop memberships
// ---------------------------------------------------------------------------

describe('UserGroup cascade', () => {
  it('deletes membership rows when the group is deleted', async () => {
    const g = await makeGroup();
    const u = await makeUser();
    await makeMembership(g, u);
    await (prisma as any).group.delete({ where: { id: g.id } });
    expect(await GroupRepository.countMembers(prisma, g.id)).toBe(0);
  });
});
