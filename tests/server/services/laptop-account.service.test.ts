/**
 * Tests for LaptopAccountService (sprint 002 "laptop accounts" T004) against
 * the real SQLite test database and FakeLaptopRosterClient.
 *
 * Covers:
 *  - desiredEntry: exact entry shape and timestamps; `created`/`created_host`
 *    kept from an existing entry; locked (`!`) when not eligible but an entry
 *    exists; null when nothing should be written; staff and admin both eligible
 *  - reconcile: written (hash verifies against the plaintext, created_host
 *    student-accounts), unchanged, display-name update preserving `created`,
 *    deactivate → `!`, flag ignored, skipped cases,
 *    failWrites/failReads/unconfigured → user action unaffected, dirty set,
 *    cleared again once writes work; audit events
 *  - pushAll counts
 *  - rosterIdTakenByOther
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import {
  LaptopAccountService,
  rosterTimestamp,
  STUDENT_ACCOUNTS_HOST,
  MANAGED_BY,
  LOCKED_HASH,
} from '../../../server/src/services/laptop/laptop-account.service.js';
import {
  UnconfiguredLaptopRosterClient,
  type RosterEntry,
} from '../../../server/src/services/laptop/laptop-roster.client.js';
import { makeCryptHash, verifyCryptHash } from '../../../server/src/utils/password.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';
import { makeUser } from '../helpers/factories.js';

const PLAINTEXT = 'purple-cactus-river';
const HASH = makeCryptHash(PLAINTEXT);
const OTHER_HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';
const NOW = new Date('2026-10-18T06:30:04.123Z');
const NOW_STAMP = '20261018T063004Z';

function laptopEntry(id: string, extra: Partial<RosterEntry> = {}): RosterEntry {
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

/** A student with a username and a laptop-compatible hash: eligible by default. */
async function makeLaptopUser(
  username: string,
  overrides: Parameters<typeof makeUser>[0] = {},
) {
  return makeUser({
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    password_hash: 'deadbeef:cafebabe',
    laptop_password_hash: HASH,
    ...overrides,
  });
}

async function reloadUser(id: number) {
  return (prisma as any).user.findUnique({ where: { id } });
}

let roster: FakeLaptopRosterClient;
let service: LaptopAccountService;

beforeEach(async () => {
  await clearDb();
  roster = new FakeLaptopRosterClient();
  service = new LaptopAccountService(roster, prisma as any, new AuditService());
});

// ---------------------------------------------------------------------------
// rosterTimestamp
// ---------------------------------------------------------------------------

describe('rosterTimestamp', () => {
  it('formats as YYYYMMDDTHHMMSSZ like league-helper', () => {
    expect(rosterTimestamp(NOW)).toBe(NOW_STAMP);
    expect(rosterTimestamp(new Date('2026-08-25T17:05:42Z'))).toBe('20260825T170542Z');
  });
});

// ---------------------------------------------------------------------------
// desiredEntry
// ---------------------------------------------------------------------------

describe('LaptopAccountService.desiredEntry', () => {
  it('builds the full entry for an eligible user with no existing entry', async () => {
    const user = await makeLaptopUser('alice');
    expect(service.desiredEntry(user, null, NOW)).toEqual({
      id: 'alice',
      display_name: 'Alice',
      password_hash: HASH,
      created: NOW_STAMP,
      created_host: STUDENT_ACCOUNTS_HOST,
      managed_by: MANAGED_BY,
      updated: NOW_STAMP,
    });
  });

  it('keeps created / created_host / renamed_from from the existing entry', async () => {
    const user = await makeLaptopUser('alice');
    const existing = laptopEntry('alice', { password_hash: OTHER_HASH, renamed_from: 'alice-old' });
    const desired = service.desiredEntry(user, existing, NOW)!;
    expect(desired.created).toBe('20260825T170542Z');
    expect(desired.created_host).toBe('jtl-inspiron-ABC123');
    expect(desired.renamed_from).toBe('alice-old');
    expect(desired.password_hash).toBe(HASH);
    expect(desired.updated).toBe(NOW_STAMP);
    expect(desired.managed_by).toBe(MANAGED_BY);
  });

  it('returns null for a user without a username', async () => {
    const user = await makeUser({ laptop_password_hash: HASH });
    expect(service.desiredEntry(user, null, NOW)).toBeNull();
  });

  it('returns null for a username that is not a valid roster id', async () => {
    const user = await makeLaptopUser('Alice');
    expect(service.desiredEntry(user, null, NOW)).toBeNull();
  });

  it('returns null when not eligible and no entry exists (never create a locked entry)', async () => {
    const user = await makeLaptopUser('bob', { is_active: false });
    expect(service.desiredEntry(user, null, NOW)).toBeNull();
  });

  it.each([
    ['deactivated', { is_active: false }],
    ['no laptop hash', { laptop_password_hash: null }],
  ])('locks (!) an existing entry when %s', async (_label, overrides) => {
    const user = await makeLaptopUser('carol', overrides);
    const existing = laptopEntry('carol');
    expect(service.desiredEntry(user, existing, NOW)).toEqual({
      id: 'carol',
      display_name: 'Carol',
      password_hash: LOCKED_HASH,
      created: existing.created,
      created_host: existing.created_host,
      managed_by: MANAGED_BY,
      updated: NOW_STAMP,
    });
  });

  it('treats admins as eligible and ignores the legacy flag', async () => {
    const user = await makeLaptopUser('root-admin', { role: 'admin', allows_laptop_account: false });
    expect(service.desiredEntry(user, null, NOW)?.password_hash).toBe(HASH);
  });

  it('treats staff as eligible', async () => {
    const user = await makeLaptopUser('dave', { role: 'staff' });
    expect(service.desiredEntry(user, null, NOW)?.password_hash).toBe(HASH);
  });
});

// ---------------------------------------------------------------------------
// reconcile — writes
// ---------------------------------------------------------------------------

describe('LaptopAccountService.reconcile — writes', () => {
  it('writes a new entry whose $6$ hash verifies against the plaintext', async () => {
    const user = await makeLaptopUser('alice');

    const outcome = await service.reconcile(user.id);

    expect(outcome).toBe('written');
    const entry = roster.entries.get('alice')!;
    expect(entry).toBeDefined();
    expect(entry.password_hash.startsWith('$6$')).toBe(true);
    expect(verifyCryptHash(PLAINTEXT, entry.password_hash)).toBe(true);
    expect(entry.created_host).toBe('student-accounts');
    expect(entry.managed_by).toBe('student-accounts');
    expect(entry.display_name).toBe('Alice');
    expect(entry.created).toMatch(/^\d{8}T\d{6}Z$/);
    expect(entry.updated).toBe(entry.created);
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(false);
  });

  it('records a laptop_roster_written audit event (system actor) without the hash', async () => {
    const user = await makeLaptopUser('alice');
    await service.reconcile(user.id);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBeNull();
    expect(JSON.stringify(events[0].details)).not.toContain('$6$');
  });

  it('records the actor on the audit event when given', async () => {
    const admin = await makeUser({ role: 'admin' });
    const user = await makeLaptopUser('alice');
    await service.reconcile(user.id, admin.id);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].target_entity_type).toBe('User');
    expect(events[0].target_entity_id).toBe(String(user.id));
    expect(events[0].details).toMatchObject({ id: 'alice', display_name: 'Alice', existed: false });
    expect(JSON.stringify(events[0].details)).not.toContain('$6$');
  });

  it('returns unchanged and writes nothing when the roster already matches', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(laptopEntry('alice', { display_name: 'Alice' }));

    expect(await service.reconcile(user.id)).toBe('unchanged');
    expect(roster.writes).toHaveLength(0);
    const events = await (prisma as any).auditEvent.findMany();
    expect(events).toHaveLength(0);
  });

  it('rewrites on a password change, keeping created and created_host', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(laptopEntry('alice', { password_hash: OTHER_HASH }));

    expect(await service.reconcile(user.id)).toBe('written');
    const entry = roster.entries.get('alice')!;
    expect(entry.password_hash).toBe(HASH);
    expect(entry.created).toBe('20260825T170542Z');
    expect(entry.created_host).toBe('jtl-inspiron-ABC123');
    expect(entry.managed_by).toBe('student-accounts');
  });

  it('rewrites on a display-name change', async () => {
    const user = await makeLaptopUser('alice', { display_name: 'Alice Liddell' });
    roster.seed(laptopEntry('alice', { display_name: 'Alice' }));

    expect(await service.reconcile(user.id)).toBe('written');
    expect(roster.entries.get('alice')!.display_name).toBe('Alice Liddell');
  });

  it('locks the entry (!) when the user is deactivated and audits laptop_roster_locked', async () => {
    const user = await makeLaptopUser('alice', { is_active: false });
    roster.seed(laptopEntry('alice'));

    expect(await service.reconcile(user.id)).toBe('locked');
    const entry = roster.entries.get('alice')!;
    expect(entry.password_hash).toBe('!');
    expect(entry.created).toBe('20260825T170542Z');
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_locked' } });
    expect(events).toHaveLength(1);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('ignores allows_laptop_account: the entry stays usable when the legacy flag is off', async () => {
    const user = await makeLaptopUser('alice');
    expect(await service.reconcile(user.id)).toBe('written');

    await (prisma as any).user.update({ where: { id: user.id }, data: { allows_laptop_account: false } });
    expect(await service.reconcile(user.id)).toBe('unchanged');
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    expect(verifyCryptHash(PLAINTEXT, roster.entries.get('alice')!.password_hash)).toBe(true);
  });

  it('writes a usable entry for an admin with a username and password', async () => {
    const admin = await makeLaptopUser('root-admin', { role: 'admin' });
    expect(await service.reconcile(admin.id)).toBe('written');
    expect(roster.entries.get('root-admin')!.password_hash).toBe(HASH);
  });

  it('does not re-lock an already locked entry', async () => {
    const user = await makeLaptopUser('alice', { is_active: false });
    roster.seed(laptopEntry('alice', { password_hash: '!' }));

    expect(await service.reconcile(user.id)).toBe('unchanged');
    expect(roster.writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// reconcile — skipped
// ---------------------------------------------------------------------------

describe('LaptopAccountService.reconcile — nothing to write', () => {
  it('skips an ineligible user who never had an entry', async () => {
    const user = await makeLaptopUser('bob', { is_active: false });
    expect(await service.reconcile(user.id)).toBe('skipped');
    expect(roster.writes).toHaveLength(0);
  });

  it('skips a user with no username and clears a stale dirty flag', async () => {
    const user = await makeUser({ laptop_password_hash: HASH, laptop_roster_dirty: true });
    expect(await service.reconcile(user.id)).toBe('skipped');
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(false);
  });

  it('skips a user whose username is not a valid roster id without touching the roster', async () => {
    const user = await makeLaptopUser('Alice');
    expect(await service.reconcile(user.id)).toBe('skipped');
    expect(roster.writes).toHaveLength(0);
  });

  it('skips an unknown user id', async () => {
    expect(await service.reconcile(9_999_999)).toBe('skipped');
  });
});

// ---------------------------------------------------------------------------
// reconcile — failures never throw
// ---------------------------------------------------------------------------

describe('LaptopAccountService.reconcile — failures', () => {
  it('on a write failure returns failed, sets laptop_roster_dirty and writes no audit event', async () => {
    const user = await makeLaptopUser('alice');
    roster.failWrites = true;

    await expect(service.reconcile(user.id)).resolves.toBe('failed');
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(true);
    expect(roster.entries.has('alice')).toBe(false);
    const events = await (prisma as any).auditEvent.findMany();
    expect(events).toHaveLength(0);
  });

  it('clears the dirty flag once a later reconcile succeeds', async () => {
    const user = await makeLaptopUser('alice');
    roster.failWrites = true;
    await service.reconcile(user.id);
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(true);

    roster.failWrites = false;
    expect(await service.reconcile(user.id)).toBe('written');
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(false);
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
  });

  it('on a read failure returns failed and sets the dirty flag', async () => {
    const user = await makeLaptopUser('alice');
    roster.failReads = true;

    await expect(service.reconcile(user.id)).resolves.toBe('failed');
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(true);
  });

  it('with an unconfigured roster returns failed and sets the dirty flag', async () => {
    const unconfigured = new LaptopAccountService(
      new UnconfiguredLaptopRosterClient(),
      prisma as any,
      new AuditService(),
    );
    const user = await makeLaptopUser('alice');

    await expect(unconfigured.reconcile(user.id)).resolves.toBe('failed');
    expect((await reloadUser(user.id)).laptop_roster_dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pushAll
// ---------------------------------------------------------------------------

describe('LaptopAccountService.pushAll', () => {
  it('reconciles every user with a username and reports counts', async () => {
    await makeLaptopUser('alice'); // written
    await makeLaptopUser('bob'); // written
    await makeLaptopUser('carol'); // unchanged (roster already matches)
    roster.seed(laptopEntry('carol'));
    await makeLaptopUser('dave', { is_active: false }); // locked (entry exists)
    roster.seed(laptopEntry('dave'));
    await makeLaptopUser('erin', { laptop_password_hash: null }); // skipped (no hash, no entry)
    await makeUser({ laptop_password_hash: HASH }); // no username: not counted at all

    const result = await service.pushAll();

    expect(result).toEqual({ written: 2, locked: 1, unchanged: 1, skipped: 1, failed: 0 });
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    expect(roster.entries.get('dave')!.password_hash).toBe('!');
    expect(roster.entries.has('erin')).toBe(false);
  });

  it('counts failures and marks those users dirty', async () => {
    const a = await makeLaptopUser('alice');
    const b = await makeLaptopUser('bob');
    roster.failWrites = true;

    const result = await service.pushAll();

    expect(result).toEqual({ written: 0, locked: 0, unchanged: 0, skipped: 0, failed: 2 });
    expect((await reloadUser(a.id)).laptop_roster_dirty).toBe(true);
    expect((await reloadUser(b.id)).laptop_roster_dirty).toBe(true);
  });

  it('returns all zeros when nobody has a username', async () => {
    await makeUser();
    expect(await service.pushAll()).toEqual({ written: 0, locked: 0, unchanged: 0, skipped: 0, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// rosterIdTakenByOther
// ---------------------------------------------------------------------------

describe('LaptopAccountService.rosterIdTakenByOther', () => {
  it('is true when the roster has the id and nobody here owns it (never imported)', async () => {
    roster.seed(laptopEntry('zoe'));
    const me = await makeUser();
    expect(await service.rosterIdTakenByOther('zoe', me.id)).toBe(true);
    expect(await service.rosterIdTakenByOther('zoe', null)).toBe(true);
  });

  it('is true when another user here owns the username', async () => {
    roster.seed(laptopEntry('zoe'));
    await makeLaptopUser('zoe');
    const me = await makeUser();
    expect(await service.rosterIdTakenByOther('zoe', me.id)).toBe(true);
  });

  it('is false when the entry belongs to the same user', async () => {
    roster.seed(laptopEntry('zoe'));
    const me = await makeLaptopUser('zoe');
    expect(await service.rosterIdTakenByOther('zoe', me.id)).toBe(false);
  });

  it('is false when the roster has no such entry', async () => {
    const me = await makeUser();
    expect(await service.rosterIdTakenByOther('alice-2', me.id)).toBe(false);
  });

  it('is false for an invalid roster id (cannot be in the roster)', async () => {
    expect(await service.rosterIdTakenByOther('Alice', null)).toBe(false);
    expect(await service.rosterIdTakenByOther('student', null)).toBe(false);
  });

  it('fails open (false) when the roster cannot be read', async () => {
    roster.seed(laptopEntry('zoe'));
    roster.failReads = true;
    expect(await service.rosterIdTakenByOther('zoe', null)).toBe(false);

    const unconfigured = new LaptopAccountService(
      new UnconfiguredLaptopRosterClient(),
      prisma as any,
      new AuditService(),
    );
    expect(await unconfigured.rosterIdTakenByOther('zoe', null)).toBe(false);
  });
});

describe('LaptopAccountService.lockRosterId', () => {
  it('rewrites an existing entry locked, keeps its provenance, and audits it', async () => {
    roster.seed(laptopEntry('zoe', { renamed_from: 'zo' }));
    const user = await makeLaptopUser('zoe-2');
    const admin = await makeUser({ role: 'admin' });

    expect(await service.lockRosterId('zoe', user.id, admin.id)).toBe('locked');

    const entry = roster.entries.get('zoe')!;
    expect(entry.password_hash).toBe('!');
    expect(entry.display_name).toBe('Zoe');
    expect(entry.created).toBe('20260825T170542Z');
    expect(entry.created_host).toBe('jtl-inspiron-ABC123');
    expect(entry.managed_by).toBe('student-accounts');
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_locked' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('is a no-op when there is no entry', async () => {
    const user = await makeLaptopUser('zoe-2');
    expect(await service.lockRosterId('zoe', user.id)).toBe('skipped');
    expect(roster.writes).toHaveLength(0);
  });

  it('is a no-op when the entry is already locked', async () => {
    roster.seed(laptopEntry('zoe', { password_hash: '!' }));
    const user = await makeLaptopUser('zoe-2');
    expect(await service.lockRosterId('zoe', user.id)).toBe('unchanged');
    expect(roster.writes).toHaveLength(0);
  });

  it('never throws when the write fails', async () => {
    roster.seed(laptopEntry('zoe'));
    roster.failWrites = true;
    const user = await makeLaptopUser('zoe-2');
    expect(await service.lockRosterId('zoe', user.id)).toBe('failed');
  });
});
