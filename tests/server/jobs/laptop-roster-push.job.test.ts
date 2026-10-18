/**
 * Tests for the laptop-roster-push job (sprint 002 "laptop accounts" T004).
 *
 * Covers:
 *  - only users with laptop_roster_dirty=true are reconciled; the flag is
 *    cleared and the roster entry written
 *  - a clean user whose roster entry is stale is left alone (that is
 *    push-all's job, not this one)
 *  - no dirty users → no roster traffic
 *  - writes still failing → users stay dirty; once writes work the next run
 *    clears them
 *  - the handler never rejects, even with an unconfigured roster
 *  - JOB_NAME / JOB_FREQUENCY match the scheduler's seedDefaults
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { SchedulerService } from '../../../server/src/services/scheduler.service.js';
import { LaptopAccountService } from '../../../server/src/services/laptop/laptop-account.service.js';
import { UnconfiguredLaptopRosterClient } from '../../../server/src/services/laptop/laptop-roster.client.js';
import {
  createLaptopRosterPushJobHandler,
  JOB_NAME,
  JOB_FREQUENCY,
} from '../../../server/src/jobs/laptop-roster-push.job.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';
import { makeUser } from '../helpers/factories.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

async function clearDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

async function makeLaptopUser(username: string, dirty: boolean) {
  return makeUser({
    username,
    display_name: username,
    password_hash: 'deadbeef:cafebabe',
    laptop_password_hash: HASH,
    laptop_roster_dirty: dirty,
  });
}

async function isDirty(id: number): Promise<boolean> {
  const u = await (prisma as any).user.findUnique({ where: { id } });
  return u.laptop_roster_dirty;
}

let roster: FakeLaptopRosterClient;
let handler: () => Promise<void>;

beforeEach(async () => {
  await clearDb();
  roster = new FakeLaptopRosterClient();
  const laptopAccounts = new LaptopAccountService(roster, prisma as any, new AuditService());
  handler = createLaptopRosterPushJobHandler({ prisma, laptopAccounts });
});

describe('laptop-roster-push job — constants', () => {
  it('is seeded hourly by SchedulerService.seedDefaults under the same name', async () => {
    expect(JOB_NAME).toBe('laptop-roster-push');
    expect(JOB_FREQUENCY).toBe('hourly');

    const scheduler = new SchedulerService(prisma);
    await scheduler.seedDefaults();
    const row = await (prisma as any).scheduledJob.findUnique({ where: { name: JOB_NAME } });
    expect(row).not.toBeNull();
    expect(row.frequency).toBe(JOB_FREQUENCY);
    expect(row.enabled).toBe(true);
  });
});

describe('laptop-roster-push job — dirty users', () => {
  it('reconciles dirty users only, clearing their flag and writing the roster', async () => {
    const dirtyA = await makeLaptopUser('alice', true);
    const dirtyB = await makeLaptopUser('bob', true);
    const clean = await makeLaptopUser('carol', false);
    // carol's roster entry is stale; a clean user is not this job's business.
    roster.seed({
      id: 'carol',
      display_name: 'Old Carol',
      password_hash: '!',
      created: '20260825T170542Z',
      created_host: 'jtl-inspiron-1',
    });

    await handler();

    expect(roster.writes.map((w) => w.id).sort()).toEqual(['alice', 'bob']);
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    expect(roster.entries.get('bob')!.password_hash).toBe(HASH);
    expect(roster.entries.get('carol')!.password_hash).toBe('!');
    expect(await isDirty(dirtyA.id)).toBe(false);
    expect(await isDirty(dirtyB.id)).toBe(false);
    expect(await isDirty(clean.id)).toBe(false);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(events).toHaveLength(2);
    expect(events.every((e: any) => e.actor_user_id === null)).toBe(true);
  });

  it('does nothing when no user is dirty', async () => {
    await makeLaptopUser('alice', false);
    await expect(handler()).resolves.toBeUndefined();
    expect(roster.writes).toHaveLength(0);
  });

  it('leaves users dirty while writes keep failing, then clears them once writes work', async () => {
    const user = await makeLaptopUser('alice', true);
    roster.failWrites = true;

    await expect(handler()).resolves.toBeUndefined();
    expect(await isDirty(user.id)).toBe(true);
    expect(roster.entries.has('alice')).toBe(false);

    roster.failWrites = false;
    await handler();
    expect(await isDirty(user.id)).toBe(false);
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
  });

  it('clears the flag for a dirty user who no longer has anything to write', async () => {
    const user = await makeUser({ laptop_roster_dirty: true }); // no username
    await handler();
    expect(await isDirty(user.id)).toBe(false);
    expect(roster.writes).toHaveLength(0);
  });

  it('never rejects, even when the roster is not configured', async () => {
    const user = await makeLaptopUser('alice', true);
    const unconfigured = createLaptopRosterPushJobHandler({
      prisma,
      laptopAccounts: new LaptopAccountService(
        new UnconfiguredLaptopRosterClient(),
        prisma as any,
        new AuditService(),
      ),
    });
    await expect(unconfigured()).resolves.toBeUndefined();
    expect(await isDirty(user.id)).toBe(true);
  });
});
