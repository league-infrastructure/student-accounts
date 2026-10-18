/**
 * Integration tests for LaptopRosterImportService (sprint 002 T003) against
 * the real SQLite test database and FakeLaptopRosterClient.
 *
 * Covers:
 *  - three entries (existing username, reserved id, normal) → created 1,
 *    matched 1, skipped 1; details carry outcomes and reasons
 *  - second run → matched 2, skipped 1, no new rows (idempotent)
 *  - created user: group membership, `username` Login with payload,
 *    created_via laptop_import, both hashes set, synthesised email, flags
 *  - mergeScan called once with the new user; its failure is non-fatal
 *  - entry with a locked (`!`) hash → created with null hashes, reason
 *  - malformed id and a prefix without config.json → skipped
 *  - group is created when missing (admin actor and null actor)
 *  - audit: create_user per created user, laptop_roster_imported summary
 *  - listIds() failure propagates (nothing to import)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { GroupService } from '../../../server/src/services/group.service.js';
import {
  LaptopRosterImportService,
  laptopImportEmail,
} from '../../../server/src/services/laptop/laptop-roster-import.service.js';
import {
  LaptopRosterNotConfiguredError,
  UnconfiguredLaptopRosterClient,
  type RosterEntry,
} from '../../../server/src/services/laptop/laptop-roster.client.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';
import { makeUser, makeGroup } from '../helpers/factories.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';
const GROUP = 'Botball 26';

function entry(id: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name: id[0].toUpperCase() + id.slice(1),
    password_hash: HASH,
    created: '20260825T170542Z',
    created_host: 'jtl-inspiron-ABC123',
    ...extra,
  };
}

async function clearDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
}

function makeService(
  roster: FakeLaptopRosterClient | UnconfiguredLaptopRosterClient,
  mergeScan: (user: any) => Promise<void> = async () => {},
): LaptopRosterImportService {
  const audit = new AuditService();
  return new LaptopRosterImportService(
    roster,
    prisma as any,
    new GroupService(prisma as any, audit),
    audit,
    mergeScan,
  );
}

let roster: FakeLaptopRosterClient;

beforeEach(async () => {
  await clearDb();
  roster = new FakeLaptopRosterClient();
});

describe('LaptopRosterImportService.importAll — three-entry roster', () => {
  beforeEach(async () => {
    // 'alice' already exists here with that username; 'root' is reserved;
    // 'bob' is a normal new entry.
    await (prisma as any).user.create({
      data: {
        username: 'alice',
        display_name: 'Alice Existing',
        primary_email: 'alice@example.com',
        role: 'student',
        created_via: 'passphrase_signup',
      },
    });
    roster.seed(entry('alice'), entry('root'), entry('bob'));
  });

  it('first run: created 1, matched 1, skipped 1 with per-entry details', async () => {
    const svc = makeService(roster);
    const report = await svc.importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 1, matched: 1, skipped: 1, errors: 0 });
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bob', outcome: 'created' }),
        expect.objectContaining({ id: 'alice', outcome: 'matched' }),
        expect.objectContaining({ id: 'root', outcome: 'skipped', reason: 'reserved id' }),
      ]),
    );
    expect(report.details).toHaveLength(3);
  });

  it('second run: matched 2, skipped 1, no new rows', async () => {
    const svc = makeService(roster);
    await svc.importAll(null, { groupName: GROUP });
    const usersAfterFirst = await (prisma as any).user.count();
    const loginsAfterFirst = await (prisma as any).login.count();
    const membersAfterFirst = await (prisma as any).userGroup.count();

    const second = await svc.importAll(null, { groupName: GROUP });

    expect(second).toMatchObject({ created: 0, matched: 2, skipped: 1, errors: 0 });
    expect(await (prisma as any).user.count()).toBe(usersAfterFirst);
    expect(await (prisma as any).login.count()).toBe(loginsAfterFirst);
    expect(await (prisma as any).userGroup.count()).toBe(membersAfterFirst);
    expect(await (prisma as any).group.count()).toBe(1);
  });

  it('matched entry is left untouched', async () => {
    const before = await (prisma as any).user.findUnique({ where: { username: 'alice' } });
    await makeService(roster).importAll(null, { groupName: GROUP });
    const after = await (prisma as any).user.findUnique({ where: { username: 'alice' } });

    expect(after).toEqual(before);
    expect(await (prisma as any).login.count({ where: { user_id: before.id } })).toBe(0);
  });

  it('created user has the group, the username Login, laptop_import and both hashes', async () => {
    await makeService(roster).importAll(null, { groupName: GROUP });

    const bob = await (prisma as any).user.findUnique({
      where: { username: 'bob' },
      include: { logins: true, groups: { include: { group: true } } },
    });
    expect(bob).toBeTruthy();
    expect(bob).toMatchObject({
      username: 'bob',
      display_name: 'Bob',
      password_hash: HASH,
      laptop_password_hash: HASH,
      role: 'student',
      created_via: 'laptop_import',
      approval_status: 'approved',
      is_active: true,
      primary_email: laptopImportEmail('bob'),
      allows_llm_proxy: true,
    });

    expect(bob.groups).toHaveLength(1);
    expect(bob.groups[0].group.name).toBe(GROUP);

    expect(bob.logins).toHaveLength(1);
    expect(bob.logins[0]).toMatchObject({
      provider: 'username',
      provider_user_id: 'laptop-import:bob',
      provider_username: 'bob',
      provider_payload: { created: '20260825T170542Z', created_host: 'jtl-inspiron-ABC123' },
    });
  });

  it('calls mergeScan once, with the created user', async () => {
    const spy = vi.fn(async (_user: any) => {});
    await makeService(roster, spy).importAll(null, { groupName: GROUP });

    expect(spy).toHaveBeenCalledTimes(1);
    const bob = await (prisma as any).user.findUnique({ where: { username: 'bob' } });
    expect(spy.mock.calls[0][0]).toMatchObject({ id: bob.id, username: 'bob' });
  });

  it('a mergeScan failure is swallowed, counted as created, and noted in reason', async () => {
    const svc = makeService(roster, async () => {
      throw new Error('haiku down');
    });
    const report = await svc.importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 1, matched: 1, skipped: 1, errors: 0 });
    const bob = report.details.find((d) => d.id === 'bob')!;
    expect(bob.outcome).toBe('created');
    expect(bob.reason).toContain('merge scan failed');
    expect(bob.reason).toContain('haiku down');
    expect(await (prisma as any).user.findUnique({ where: { username: 'bob' } })).toBeTruthy();
  });

  it('records create_user (source laptop_import) and a laptop_roster_imported summary', async () => {
    const admin = await makeUser({ role: 'admin' });
    const report = await makeService(roster).importAll(admin.id, { groupName: GROUP });

    const bob = await (prisma as any).user.findUnique({ where: { username: 'bob' } });
    const creates = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_user' },
    });
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      actor_user_id: admin.id,
      target_user_id: bob.id,
      target_entity_type: 'User',
      target_entity_id: String(bob.id),
    });
    expect(creates[0].details).toMatchObject({ source: 'laptop_import' });

    const summaries = await (prisma as any).auditEvent.findMany({
      where: { action: 'laptop_roster_imported' },
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].actor_user_id).toBe(admin.id);
    expect(summaries[0].details).toMatchObject({
      group_name: GROUP,
      created: report.created,
      matched: report.matched,
      skipped: report.skipped,
      errors: report.errors,
    });
  });
});

describe('LaptopRosterImportService.importAll — groups', () => {
  it('creates the group when missing (admin actor) with a create_group audit', async () => {
    const admin = await makeUser({ role: 'admin' });
    roster.seed(entry('carol'));
    await makeService(roster).importAll(admin.id, { groupName: GROUP });

    const group = await (prisma as any).group.findUnique({ where: { name: GROUP } });
    expect(group).toBeTruthy();
    const created = await (prisma as any).auditEvent.findMany({ where: { action: 'create_group' } });
    expect(created).toHaveLength(1);
    expect(created[0].actor_user_id).toBe(admin.id);
  });

  it('creates the group when missing (null actor, script)', async () => {
    roster.seed(entry('carol'));
    await makeService(roster).importAll(null, { groupName: 'Scripted Group' });

    const group = await (prisma as any).group.findUnique({ where: { name: 'Scripted Group' } });
    expect(group).toBeTruthy();
    const created = await (prisma as any).auditEvent.findMany({ where: { action: 'create_group' } });
    expect(created).toHaveLength(1);
    expect(created[0].actor_user_id).toBeNull();
    const member = await (prisma as any).userGroup.findFirst({ where: { group_id: group.id } });
    expect(member).toBeTruthy();
  });

  it('reuses an existing group by name', async () => {
    const existing = await makeGroup({ name: GROUP });
    roster.seed(entry('carol'));
    await makeService(roster).importAll(null, { groupName: GROUP });

    expect(await (prisma as any).group.count()).toBe(1);
    const carol = await (prisma as any).user.findUnique({ where: { username: 'carol' } });
    const membership = await (prisma as any).userGroup.findUnique({
      where: { user_id_group_id: { user_id: carol.id, group_id: existing.id } },
    });
    expect(membership).toBeTruthy();
  });

  it('a blank groupName falls back to the default "Botball 26"', async () => {
    roster.seed(entry('carol'));
    await makeService(roster).importAll(null, { groupName: '   ' });
    expect(await (prisma as any).group.findUnique({ where: { name: 'Botball 26' } })).toBeTruthy();
  });
});

describe('LaptopRosterImportService.importAll — hashes and odd entries', () => {
  it('locked entry (`!`) is created with null hashes and reason "no usable hash"', async () => {
    roster.seed(entry('dave', { password_hash: '!' }));
    const report = await makeService(roster).importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 1, errors: 0 });
    expect(report.details[0]).toEqual({ id: 'dave', outcome: 'created', reason: 'no usable hash' });
    const dave = await (prisma as any).user.findUnique({ where: { username: 'dave' } });
    expect(dave.password_hash).toBeNull();
    expect(dave.laptop_password_hash).toBeNull();
  });

  it('empty display_name falls back to the id', async () => {
    roster.seed(entry('erin', { display_name: '' }));
    await makeService(roster).importAll(null, { groupName: GROUP });
    const erin = await (prisma as any).user.findUnique({ where: { username: 'erin' } });
    expect(erin.display_name).toBe('erin');
  });

  it('malformed ids are skipped with reason "malformed id"', async () => {
    roster.seed(entry('Bad_Name'), entry('ab'));
    const report = await makeService(roster).importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 0, matched: 0, skipped: 2, errors: 0 });
    for (const d of report.details) {
      expect(d.outcome).toBe('skipped');
      expect(d.reason).toBe('malformed id');
    }
    expect(await (prisma as any).user.count()).toBe(0);
  });

  it('a prefix without config.json is skipped', async () => {
    roster.seed(entry('frank'));
    // Override listIds to include an id that read() resolves to null.
    const listIds = roster.listIds.bind(roster);
    roster.listIds = async () => [...(await listIds()), 'ghost'];
    const report = await makeService(roster).importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 1, skipped: 1, errors: 0 });
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'ghost', outcome: 'skipped', reason: 'no config.json' }),
      ]),
    );
  });

  it('a per-entry read failure is counted as an error and the run continues', async () => {
    roster.seed(entry('gina'), entry('hank'));
    const read = roster.read.bind(roster);
    roster.read = async (id: string) => {
      if (id === 'gina') throw new Error('boom');
      return read(id);
    };
    const report = await makeService(roster).importAll(null, { groupName: GROUP });

    expect(report).toMatchObject({ created: 1, matched: 0, skipped: 0, errors: 1 });
    expect(report.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'gina', outcome: 'error', reason: 'boom' }),
        expect.objectContaining({ id: 'hank', outcome: 'created' }),
      ]),
    );
  });

  it('empty roster → all zeros, group still ensured', async () => {
    const report = await makeService(roster).importAll(null, { groupName: GROUP });
    expect(report).toEqual({ created: 0, matched: 0, skipped: 0, errors: 0, details: [] });
    expect(await (prisma as any).group.findUnique({ where: { name: GROUP } })).toBeTruthy();
  });

  it('listIds() failure propagates (LaptopRosterNotConfiguredError)', async () => {
    const svc = makeService(new UnconfiguredLaptopRosterClient());
    await expect(svc.importAll(null, { groupName: GROUP })).rejects.toBeInstanceOf(
      LaptopRosterNotConfiguredError,
    );
    expect(await (prisma as any).group.count()).toBe(0);
  });
});
