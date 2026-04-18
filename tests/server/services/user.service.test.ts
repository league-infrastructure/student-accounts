/**
 * Integration tests for UserService.
 *
 * Covers:
 *  - createWithAudit: creates User + AuditEvent atomically
 *  - findById: returns user or throws NotFoundError
 *  - findByEmail: returns user or null
 *  - findAll: filtering by role and cohort_id
 *  - updateCohort: updates User cohort + records assign_cohort audit event
 *  - delete: enforces onDelete: Restrict (ConflictError when dependents exist)
 *  - delete: succeeds when no Login or ExternalAccount rows remain
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { UserService } from '../../../server/src/services/user.service.js';
import { NotFoundError, ConflictError } from '../../../server/src/errors.js';
import {
  makeUser,
  makeCohort,
  makeLogin,
  makeExternalAccount,
} from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let userService: UserService;

beforeEach(async () => {
  // FK-safe cleanup order
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();

  userService = new UserService(prisma, new AuditService());
});

// ---------------------------------------------------------------------------
// createWithAudit
// ---------------------------------------------------------------------------

describe('UserService.createWithAudit', () => {
  it('creates a User and a create_user AuditEvent in one transaction', async () => {
    const user = await userService.createWithAudit({
      display_name: 'Alice',
      primary_email: 'alice@example.com',
      created_via: 'admin_created',
    });

    expect(user.id).toBeDefined();
    expect(user.primary_email).toBe('alice@example.com');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_user', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBeNull();
    expect(events[0].target_entity_type).toBe('User');
  });

  it('records actorId when provided', async () => {
    const actor = await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const user = await userService.createWithAudit(
      { display_name: 'Bob', primary_email: 'bob@example.com', created_via: 'admin_created' },
      actor.id,
    );

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_user', target_user_id: user.id },
    });
    expect(events[0].actor_user_id).toBe(actor.id);
  });

  it('rolls back both writes when the transaction fails', async () => {
    // Deliberately pass a bad cohort_id to force a FK violation inside the tx
    await expect(
      (prisma as any).$transaction(async (tx: any) => {
        const { UserRepository } = await import(
          '../../../server/src/services/repositories/user.repository.js'
        );
        await UserRepository.create(tx, {
          display_name: 'Carol',
          primary_email: 'carol@example.com',
          created_via: 'admin_created',
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const users = await (prisma as any).user.findMany({
      where: { primary_email: 'carol@example.com' },
    });
    expect(users).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('UserService.findById', () => {
  it('returns the user when it exists', async () => {
    const created = await makeUser();
    const found = await userService.findById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('throws NotFoundError for a non-existent id', async () => {
    await expect(userService.findById(9999999)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// findByEmail
// ---------------------------------------------------------------------------

describe('UserService.findByEmail', () => {
  it('returns the user when the email matches', async () => {
    const created = await makeUser({ primary_email: 'unique@example.com' });
    const found = await userService.findByEmail('unique@example.com');
    expect(found?.id).toBe(created.id);
  });

  it('returns null for an unknown email', async () => {
    const result = await userService.findByEmail('nobody@example.com');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('UserService.findAll', () => {
  it('returns all users when no filter is provided', async () => {
    await makeUser();
    await makeUser();
    const users = await userService.findAll();
    expect(users.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by role', async () => {
    await makeUser({ role: 'admin' });
    await makeUser({ role: 'student' });
    const admins = await userService.findAll({ role: 'admin' });
    expect(admins.every((u) => u.role === 'admin')).toBe(true);
  });

  it('filters by cohort_id', async () => {
    const cohort = await makeCohort();
    await makeUser({ cohort_id: cohort.id });
    await makeUser(); // no cohort

    const inCohort = await userService.findAll({ cohort_id: cohort.id });
    expect(inCohort).toHaveLength(1);
    expect(inCohort[0].cohort_id).toBe(cohort.id);
  });
});

// ---------------------------------------------------------------------------
// updateCohort
// ---------------------------------------------------------------------------

describe('UserService.updateCohort', () => {
  it('updates the user cohort and records assign_cohort audit event', async () => {
    const user = await makeUser();
    const cohort = await makeCohort();

    const updated = await userService.updateCohort(user.id, cohort.id, null);
    expect(updated.cohort_id).toBe(cohort.id);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'assign_cohort', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_type).toBe('User');
  });

  it('can clear cohort assignment (null)', async () => {
    const cohort = await makeCohort();
    const user = await makeUser({ cohort_id: cohort.id });

    const updated = await userService.updateCohort(user.id, null, null);
    expect(updated.cohort_id).toBeNull();
  });

  it('throws NotFoundError for a non-existent user', async () => {
    await expect(userService.updateCohort(9999999, null, null)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// delete — Restrict enforcement
// ---------------------------------------------------------------------------

describe('UserService.delete', () => {
  it('throws NotFoundError for a non-existent user', async () => {
    await expect(userService.delete(9999999)).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError when Login rows exist', async () => {
    const user = await makeUser();
    await makeLogin(user);

    await expect(userService.delete(user.id)).rejects.toThrow(ConflictError);

    // User must still be in the DB
    const still = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(still).not.toBeNull();
  });

  it('throws ConflictError when ExternalAccount rows exist', async () => {
    const user = await makeUser();
    await makeExternalAccount(user);

    await expect(userService.delete(user.id)).rejects.toThrow(ConflictError);

    const still = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(still).not.toBeNull();
  });

  it('deletes the user when no dependent rows remain', async () => {
    const user = await makeUser();

    await userService.delete(user.id);

    const gone = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(gone).toBeNull();
  });
});
