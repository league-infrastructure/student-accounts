/**
 * Integration tests for AuditService — atomic write pattern.
 *
 * These tests verify the UC-021 requirement: AuditEvent rows are committed
 * atomically with the triggering domain write. Uses a real SQLite database
 * with no mocking.
 *
 * Three scenarios are covered:
 *  1. Successful write — User and AuditEvent both persist.
 *  2. Atomic rollback — an error thrown inside the transaction leaves both
 *     tables empty.
 *  3. Audit write failure causes rollback of the primary write.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { UserService } from '../../../server/src/services/user.service.js';

// ---------------------------------------------------------------------------
// Cleanup before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
});

// ---------------------------------------------------------------------------
// Test 1: Successful write — both rows persist
// ---------------------------------------------------------------------------

describe('AuditService.record — successful write', () => {
  it('creates one User and one AuditEvent with correct fields', async () => {
    const audit = new AuditService();
    const userService = new UserService(prisma, audit);

    const user = await userService.createWithAudit(
      {
        display_name: 'Alice',
        primary_email: 'alice@example.com',
        created_via: 'admin_created',
      },
      null, // system action — no actor
    );

    // Verify the user was persisted
    const userRow = await UserRepository.findById(prisma, user.id);
    expect(userRow).not.toBeNull();
    expect(userRow!.primary_email).toBe('alice@example.com');

    // Verify exactly one AuditEvent was written with the correct fields
    const events = await (prisma as any).auditEvent.findMany({
      where: { target_entity_type: 'User' },
    });
    expect(events).toHaveLength(1);

    const event = events[0];
    expect(event.action).toBe('create_user');
    expect(event.actor_user_id).toBeNull();
    expect(event.target_user_id).toBe(user.id);
    expect(event.target_entity_type).toBe('User');
    expect(event.target_entity_id).toBe(String(user.id));
    expect(event.created_at).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Atomic rollback — throw after writes; both rows must disappear
// ---------------------------------------------------------------------------

describe('AuditService.record — atomic rollback', () => {
  it('rolls back both the User row and the AuditEvent row when the transaction throws', async () => {
    const audit = new AuditService();

    await expect(
      (prisma as any).$transaction(async (tx: any) => {
        // Primary write
        const user = await UserRepository.create(tx, {
          display_name: 'Bob',
          primary_email: 'bob@example.com',
          created_via: 'admin_created',
        });

        // Audit write — inside the same transaction
        await audit.record(tx, {
          actor_user_id: null,
          action: 'create_user',
          target_user_id: user.id,
          target_entity_type: 'User',
          target_entity_id: String(user.id),
        });

        // Simulate a failure that occurs after both writes but before commit
        throw new Error('Simulated failure after writes');
      }),
    ).rejects.toThrow('Simulated failure after writes');

    // Neither the User row nor the AuditEvent row should exist
    const users = await (prisma as any).user.findMany({
      where: { primary_email: 'bob@example.com' },
    });
    expect(users).toHaveLength(0);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_user' },
    });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Audit write failure rolls back the primary write
// ---------------------------------------------------------------------------

describe('AuditService.record — audit failure causes full rollback', () => {
  it('rolls back the User row when the audit write is forced to fail', async () => {
    const audit = new AuditService();

    // Strategy: wrap the real audit.record and throw after the primary write
    // succeeds but before the transaction commits. This simulates any condition
    // (constraint violation, network error, etc.) that causes the audit write
    // to fail.
    const failingAudit: AuditService = {
      async record(_tx, _event) {
        throw new Error('Audit write failed');
      },
    } as AuditService;

    await expect(
      (prisma as any).$transaction(async (tx: any) => {
        // Primary write
        await UserRepository.create(tx, {
          display_name: 'Carol',
          primary_email: 'carol@example.com',
          created_via: 'admin_created',
        });

        // This call throws — the transaction must roll back the User row
        await failingAudit.record(tx, {
          action: 'create_user',
          target_entity_type: 'User',
        });
      }),
    ).rejects.toThrow('Audit write failed');

    // The User row must not exist — the primary write was rolled back
    const users = await (prisma as any).user.findMany({
      where: { primary_email: 'carol@example.com' },
    });
    expect(users).toHaveLength(0);

    // No audit events either
    const events = await (prisma as any).auditEvent.findMany();
    expect(events).toHaveLength(0);
  });
});
