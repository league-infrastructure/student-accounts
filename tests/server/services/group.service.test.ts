/**
 * Integration tests for GroupService (Sprint 012 T002).
 *
 * Uses a real SQLite database via the shared Prisma client. Tests exercise
 * the service against real data so audit events and transaction boundaries
 * are verified end-to-end.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { GroupService } from '../../../server/src/services/group.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../../server/src/errors.js';
import { makeUser, makeLogin, makeGroup, makeMembership } from '../helpers/factories.js';

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
// create
// ---------------------------------------------------------------------------

describe('GroupService.create', () => {
  it('creates a group and emits create_group', async () => {
    const actor = await makeUser({ display_name: 'Admin', role: 'admin' });
    const g = await service.create({ name: 'Alpha', description: 'first' }, actor.id);
    expect(g.id).toBeGreaterThan(0);
    expect(g.name).toBe('Alpha');
    expect(g.description).toBe('first');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_group' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_entity_type).toBe('Group');
    expect(events[0].target_entity_id).toBe(String(g.id));
    expect(events[0].actor_user_id).toBe(actor.id);
  });

  it('trims whitespace in the name', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: '  Trimmed  ' }, actor.id);
    expect(g.name).toBe('Trimmed');
  });

  it('throws ValidationError on blank name', async () => {
    const actor = await makeUser({ role: 'admin' });
    await expect(service.create({ name: '   ' }, actor.id)).rejects.toThrow(
      ValidationError,
    );
  });

  it('throws ConflictError on duplicate name', async () => {
    const actor = await makeUser({ role: 'admin' });
    await service.create({ name: 'Dup' }, actor.id);
    await expect(service.create({ name: 'Dup' }, actor.id)).rejects.toThrow(
      ConflictError,
    );
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('GroupService.update', () => {
  it('updates name and description and emits update_group', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'Before' }, actor.id);

    const updated = await service.update(
      g.id,
      { name: 'After', description: 'changed' },
      actor.id,
    );
    expect(updated.name).toBe('After');
    expect(updated.description).toBe('changed');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'update_group', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
  });

  it('throws NotFoundError if group does not exist', async () => {
    const actor = await makeUser({ role: 'admin' });
    await expect(
      service.update(99999, { name: 'X' }, actor.id),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError on blank name', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'OK' }, actor.id);
    await expect(
      service.update(g.id, { name: '   ' }, actor.id),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError on duplicate name', async () => {
    const actor = await makeUser({ role: 'admin' });
    const a = await service.create({ name: 'A' }, actor.id);
    await service.create({ name: 'B' }, actor.id);
    await expect(
      service.update(a.id, { name: 'B' }, actor.id),
    ).rejects.toThrow(ConflictError);
  });

  it('accepts same-name no-op without conflict', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'SameName' }, actor.id);
    const updated = await service.update(
      g.id,
      { name: 'SameName' },
      actor.id,
    );
    expect(updated.name).toBe('SameName');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('GroupService.delete', () => {
  it('deletes a group + memberships, emits delete_group with memberCount', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'ToDelete' }, actor.id);
    const u1 = await makeUser();
    const u2 = await makeUser();
    await service.addMember(g.id, u1.id, actor.id);
    await service.addMember(g.id, u2.id, actor.id);

    await service.delete(g.id, actor.id);

    expect(
      await (prisma as any).group.findUnique({ where: { id: g.id } }),
    ).toBeNull();
    expect(
      await (prisma as any).userGroup.count({ where: { group_id: g.id } }),
    ).toBe(0);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'delete_group', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
    const details = events[0].details as any;
    expect(details.memberCount).toBe(2);
    expect(details.name).toBe('ToDelete');
  });

  it('throws NotFoundError when missing', async () => {
    const actor = await makeUser({ role: 'admin' });
    await expect(service.delete(99999, actor.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// findById / findAll / listMembers
// ---------------------------------------------------------------------------

describe('GroupService.findById / findAll / listMembers', () => {
  it('findById returns the group', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'FindMe' }, actor.id);
    const got = await service.findById(g.id);
    expect(got.id).toBe(g.id);
  });

  it('findById throws NotFoundError if missing', async () => {
    await expect(service.findById(9999)).rejects.toThrow(NotFoundError);
  });

  it('findAll returns summaries with memberCount', async () => {
    const actor = await makeUser({ role: 'admin' });
    const a = await service.create({ name: 'A' }, actor.id);
    const u = await makeUser();
    await service.addMember(a.id, u.id, actor.id);
    await service.create({ name: 'B' }, actor.id);

    const summaries = await service.findAll();
    const byName = Object.fromEntries(summaries.map((s) => [s.name, s]));
    expect(byName.A.memberCount).toBe(1);
    expect(byName.B.memberCount).toBe(0);
    // Ordered by name
    expect(summaries.map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('listMembers returns projection shape aligned with cohort members', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'WithMembers' }, actor.id);
    const u = await makeUser({ display_name: 'Alice' });
    await service.addMember(g.id, u.id, actor.id);

    const { group, users } = await service.listMembers(g.id);
    expect(group.id).toBe(g.id);
    expect(users.length).toBe(1);
    expect(users[0].displayName).toBe('Alice');
    expect(users[0].externalAccounts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// addMember / removeMember
// ---------------------------------------------------------------------------

describe('GroupService.addMember / removeMember', () => {
  it('addMember creates UserGroup and emits add_group_member', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'Add' }, actor.id);
    const u = await makeUser({ display_name: 'Uuu' });

    await service.addMember(g.id, u.id, actor.id);

    const row = await (prisma as any).userGroup.findUnique({
      where: { user_id_group_id: { user_id: u.id, group_id: g.id } },
    });
    expect(row).not.toBeNull();

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'add_group_member', target_entity_id: String(g.id) },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_user_id).toBe(u.id);
    expect((events[0].details as any).group_name).toBe('Add');
  });

  it('addMember throws ConflictError when already a member', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'G' }, actor.id);
    const u = await makeUser();
    await service.addMember(g.id, u.id, actor.id);
    await expect(
      service.addMember(g.id, u.id, actor.id),
    ).rejects.toThrow(ConflictError);
  });

  it('addMember throws NotFoundError on missing group', async () => {
    const actor = await makeUser({ role: 'admin' });
    const u = await makeUser();
    await expect(
      service.addMember(99999, u.id, actor.id),
    ).rejects.toThrow(NotFoundError);
  });

  it('addMember throws NotFoundError on missing user', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'G' }, actor.id);
    await expect(
      service.addMember(g.id, 99999, actor.id),
    ).rejects.toThrow(NotFoundError);
  });

  it('removeMember deletes row and emits remove_group_member', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'G' }, actor.id);
    const u = await makeUser();
    await service.addMember(g.id, u.id, actor.id);

    await service.removeMember(g.id, u.id, actor.id);

    const row = await (prisma as any).userGroup.findUnique({
      where: { user_id_group_id: { user_id: u.id, group_id: g.id } },
    });
    expect(row).toBeNull();

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'remove_group_member' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_user_id).toBe(u.id);
  });

  it('removeMember throws NotFoundError when not a member', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'G' }, actor.id);
    const u = await makeUser();
    await expect(
      service.removeMember(g.id, u.id, actor.id),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// searchUsersNotInGroup
// ---------------------------------------------------------------------------

describe('GroupService.searchUsersNotInGroup', () => {
  it('returns [] for queries shorter than 2 characters', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'Srch' }, actor.id);
    await makeUser({ display_name: 'Alice' });
    expect(await service.searchUsersNotInGroup(g.id, 'a')).toEqual([]);
    expect(await service.searchUsersNotInGroup(g.id, '')).toEqual([]);
  });

  it('matches across the four configured fields', async () => {
    const actor = await makeUser({ role: 'admin' });
    const g = await service.create({ name: 'Srch2' }, actor.id);
    const u = await makeUser({
      display_name: 'Zzz',
      primary_email: 'zed@alt.io',
    });
    await makeLogin(u, {
      provider_username: 'github-alias' as any,
      provider_email: null,
    } as any);

    const byName = await service.searchUsersNotInGroup(g.id, 'Zzz');
    expect(byName.length).toBe(1);
    expect(byName[0].matchedOn).toBe('display_name');

    const byEmail = await service.searchUsersNotInGroup(g.id, 'alt.io');
    expect(byEmail.length).toBe(1);
    expect(byEmail[0].matchedOn).toBe('primary_email');

    const byLoginUser = await service.searchUsersNotInGroup(g.id, 'github-alias');
    expect(byLoginUser.length).toBe(1);
    expect(byLoginUser[0].matchedOn).toBe('provider_username');
  });

  it('throws NotFoundError if the group is missing', async () => {
    await expect(
      service.searchUsersNotInGroup(99999, 'anything'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// listGroupsForUser
// ---------------------------------------------------------------------------

describe('GroupService.listGroupsForUser', () => {
  it('returns { id, name } pairs in name order', async () => {
    const actor = await makeUser({ role: 'admin' });
    const a = await service.create({ name: 'A' }, actor.id);
    const z = await service.create({ name: 'Z' }, actor.id);
    const u = await makeUser();
    await service.addMember(z.id, u.id, actor.id);
    await service.addMember(a.id, u.id, actor.id);

    const groups = await service.listGroupsForUser(u.id);
    expect(groups.map((g) => g.name)).toEqual(['A', 'Z']);
  });

  it('returns empty when user in no groups', async () => {
    const u = await makeUser();
    expect(await service.listGroupsForUser(u.id)).toEqual([]);
  });
});
