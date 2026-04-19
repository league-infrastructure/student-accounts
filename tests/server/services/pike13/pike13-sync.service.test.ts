/**
 * Integration tests for Pike13SyncService (Sprint 006 T003).
 *
 * Covers:
 *  - Happy path: all-new users created (no existing Users or ExternalAccounts)
 *  - Happy path: all-existing users matched by pike13 ExternalAccount
 *  - Happy path: all-existing users matched by primary_email
 *  - Mixed: some new, some matched
 *  - Skipped: person with no email → counted in skipped, sync continues
 *  - API error on page 1 (only page): errors=1, created/matched/skipped=0
 *  - Empty Pike13 result: all counts are 0
 *  - AuditEvent recorded for each created User (action=create_user)
 *  - AuditEvent recorded at sync completion (action=pike13_sync_completed)
 *  - mergeScan called for each newly created User
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { Pike13SyncService } from '../../../../server/src/services/pike13/pike13-sync.service.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';
import { Pike13ApiError } from '../../../../server/src/services/pike13/pike13-api.client.js';
import { FakePike13ApiClient } from '../../helpers/fake-pike13-api.client.js';
import { makeUser, makeExternalAccount } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Test DB helpers
// ---------------------------------------------------------------------------

async function clearDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

function makeService(
  fake: FakePike13ApiClient,
  mergeScanSpy?: (user: any) => Promise<void>,
): Pike13SyncService {
  return new Pike13SyncService(
    fake,
    prisma as any,
    UserRepository,
    ExternalAccountRepository,
    new AuditService(),
    mergeScanSpy ?? (async () => {}),
  );
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let fake: FakePike13ApiClient;

beforeEach(async () => {
  await clearDb();
  fake = new FakePike13ApiClient();
});

// ---------------------------------------------------------------------------
// Empty Pike13 result
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — empty Pike13 result', () => {
  it('returns all-zero SyncReport when Pike13 has no people', async () => {
    // Default fake returns { people: [], nextCursor: null }
    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.created).toBe(0);
    expect(report.matched).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);
    expect(report.errorDetails).toHaveLength(0);
  });

  it('calls listPeople exactly once for a single empty page', async () => {
    const svc = makeService(fake);
    await svc.sync();

    expect(fake.calls.listPeople).toHaveLength(1);
    expect(fake.calls.listPeople[0]).toBeUndefined(); // first page
  });
});

// ---------------------------------------------------------------------------
// Happy path: all-new users created
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — all-new users', () => {
  it('creates User and ExternalAccount for each unmatched person', async () => {
    fake.configure('listPeople', {
      people: [
        { id: 101, first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' },
        { id: 102, first_name: 'Bob', last_name: 'Jones', email: 'bob@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.created).toBe(2);
    expect(report.matched).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);

    // Users exist in DB
    const alice = await (prisma as any).user.findUnique({ where: { primary_email: 'alice@example.com' } });
    expect(alice).not.toBeNull();
    expect(alice.role).toBe('student');
    expect(alice.created_via).toBe('pike13_sync');
    expect(alice.display_name).toBe('Alice Smith');

    // ExternalAccounts exist
    const aliceAccount = await (prisma as any).externalAccount.findFirst({
      where: { user_id: alice.id, type: 'pike13' },
    });
    expect(aliceAccount).not.toBeNull();
    expect(aliceAccount.external_id).toBe('101');
    expect(aliceAccount.status).toBe('active');
  });

  it('calls mergeScan for each newly created User', async () => {
    const mergeScanSpy = vi.fn(async () => {});

    fake.configure('listPeople', {
      people: [
        { id: 201, first_name: 'Carol', last_name: 'Lee', email: 'carol@example.com' },
        { id: 202, first_name: 'Dave', last_name: 'Kim', email: 'dave@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake, mergeScanSpy);
    await svc.sync();

    expect(mergeScanSpy).toHaveBeenCalledTimes(2);
  });

  it('records a create_user audit event for each new User', async () => {
    fake.configure('listPeople', {
      people: [
        { id: 301, first_name: 'Eve', last_name: 'White', email: 'eve@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    await svc.sync();

    const auditEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_user' },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].details?.source).toBe('pike13_sync');
    expect(auditEvents[0].details?.pike13_person_id).toBe(301);
  });

  it('records a pike13_sync_completed audit event with counts', async () => {
    fake.configure('listPeople', {
      people: [
        { id: 401, first_name: 'Frank', last_name: 'Black', email: 'frank@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    const syncEvent = await (prisma as any).auditEvent.findFirst({
      where: { action: 'pike13_sync_completed' },
    });
    expect(syncEvent).not.toBeNull();
    expect(syncEvent.details?.created).toBe(report.created);
    expect(syncEvent.details?.matched).toBe(report.matched);
    expect(syncEvent.details?.skipped).toBe(report.skipped);
    expect(syncEvent.details?.errors).toBe(report.errors);
  });
});

// ---------------------------------------------------------------------------
// Happy path: all matched by pike13 ExternalAccount
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — match by pike13 ExternalAccount', () => {
  it('counts existing pike13 ExternalAccount as matched, not created', async () => {
    const existingUser = await makeUser({ primary_email: 'matched@example.com' });
    await makeExternalAccount(existingUser, {
      type: 'pike13',
      external_id: '501',
      status: 'active',
    });

    fake.configure('listPeople', {
      people: [
        { id: 501, first_name: 'Grace', last_name: 'Hall', email: 'matched@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.matched).toBe(1);
    expect(report.created).toBe(0);

    // No duplicate User created
    const users = await (prisma as any).user.findMany({ where: { primary_email: 'matched@example.com' } });
    expect(users).toHaveLength(1);
  });

  it('does not call mergeScan for matched users', async () => {
    const mergeScanSpy = vi.fn(async () => {});
    const existingUser = await makeUser({ primary_email: 'nomerge@example.com' });
    await makeExternalAccount(existingUser, { type: 'pike13', external_id: '502', status: 'active' });

    fake.configure('listPeople', {
      people: [{ id: 502, first_name: 'Hugo', last_name: 'Moss', email: 'nomerge@example.com' }],
      nextCursor: null,
    });

    const svc = makeService(fake, mergeScanSpy);
    await svc.sync();

    expect(mergeScanSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path: all matched by primary_email
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — match by primary_email', () => {
  it('counts email-matched existing User as matched', async () => {
    await makeUser({ primary_email: 'emailmatch@example.com' });

    fake.configure('listPeople', {
      people: [
        { id: 601, first_name: 'Iris', last_name: 'Stone', email: 'emailmatch@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.matched).toBe(1);
    expect(report.created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mixed: some new, some matched
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — mixed new and matched', () => {
  it('reports correct counts for a mixed page', async () => {
    // Pre-existing user matched by email
    await makeUser({ primary_email: 'existing@example.com' });

    fake.configure('listPeople', {
      people: [
        { id: 701, first_name: 'Jack', last_name: 'Reed', email: 'new@example.com' },
        { id: 702, first_name: 'Kate', last_name: 'Ford', email: 'existing@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.created).toBe(1);
    expect(report.matched).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Skipped: person missing email
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — skipped (no email)', () => {
  it('skips a person with no email and continues', async () => {
    fake.configure('listPeople', {
      people: [
        { id: 801, first_name: 'Liam', last_name: 'Park', email: '' },
        { id: 802, first_name: 'Maya', last_name: 'Cruz', email: 'maya@example.com' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.skipped).toBe(1);
    expect(report.created).toBe(1); // maya created
    expect(report.errors).toBe(0);
  });

  it('does not create User or ExternalAccount for a skipped person', async () => {
    fake.configure('listPeople', {
      people: [
        { id: 803, first_name: 'Nina', last_name: 'Bell', email: '' },
      ],
      nextCursor: null,
    });

    const svc = makeService(fake);
    await svc.sync();

    const users = await (prisma as any).user.findMany();
    expect(users).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// API error mid-pagination (error on page 1, only page)
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — API error on page', () => {
  it('records the error and stops pagination on API failure', async () => {
    fake.configureError('listPeople', new Pike13ApiError('API down', 'listPeople', 503));

    const svc = makeService(fake);
    const report = await svc.sync();

    expect(report.errors).toBe(1);
    expect(report.errorDetails).toHaveLength(1);
    expect(report.errorDetails[0]).toContain('API down');
    expect(report.created).toBe(0);
    expect(report.matched).toBe(0);
    expect(report.skipped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pagination: multiple pages
// ---------------------------------------------------------------------------

describe('Pike13SyncService.sync — pagination', () => {
  it('follows nextCursor to fetch subsequent pages', async () => {
    // Simulate two pages by using vi.fn() on the listPeople method.
    const page1 = {
      people: [{ id: 901, first_name: 'Oscar', last_name: 'Wu', email: 'oscar@example.com' }],
      nextCursor: 'cursor-page-2',
    };
    const page2 = {
      people: [{ id: 902, first_name: 'Penny', last_name: 'Fox', email: 'penny@example.com' }],
      nextCursor: null,
    };

    let callCount = 0;
    const multiPageFake: any = {
      listPeople: vi.fn().mockImplementation(async (cursor?: string) => {
        callCount++;
        return callCount === 1 ? page1 : page2;
      }),
      getPerson: vi.fn(),
      updateCustomField: vi.fn(),
    };

    const svc = makeService(multiPageFake as FakePike13ApiClient);
    const report = await svc.sync();

    expect(report.created).toBe(2);
    expect(multiPageFake.listPeople).toHaveBeenCalledTimes(2);
    expect(multiPageFake.listPeople).toHaveBeenNthCalledWith(1, undefined);
    expect(multiPageFake.listPeople).toHaveBeenNthCalledWith(2, 'cursor-page-2');
  });
});
