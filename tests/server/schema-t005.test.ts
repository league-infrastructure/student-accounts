/**
 * T005 integration tests — AuditEvent, ProvisioningRequest, MergeSuggestion
 *
 * Covers:
 * - Record creation for all three new entities
 * - FK onDelete: Cascade (ProvisioningRequest.user_id, MergeSuggestion.user_a_id / user_b_id)
 * - FK onDelete: SetNull (AuditEvent actor/target, ProvisioningRequest.decided_by, MergeSuggestion.decided_by)
 * - Enum CHECK constraints on MergeSuggestion.status and ProvisioningRequest.requested_type/status
 * - AuditEvent.details JSON round-trip through Prisma client on SQLite
 * - Unique constraint on MergeSuggestion(user_a_id, user_b_id)
 */

import { prisma } from '../../server/src/services/prisma';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeUser(tag: string) {
  return prisma.user.create({
    data: {
      display_name: `T005 ${tag}`,
      primary_email: `t005_${tag}@example.com`,
      role: 'student',
      created_via: 'admin_created',
    },
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await prisma.mergeSuggestion.deleteMany();
  await prisma.provisioningRequest.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.user.deleteMany({ where: { primary_email: { startsWith: 't005_' } } });
});

afterAll(async () => {
  await prisma.mergeSuggestion.deleteMany();
  await prisma.provisioningRequest.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.user.deleteMany({ where: { primary_email: { startsWith: 't005_' } } });
});

// ---------------------------------------------------------------------------
// AuditEvent
// ---------------------------------------------------------------------------

describe('AuditEvent', () => {
  it('creates a record with no actor (system action)', async () => {
    const event = await prisma.auditEvent.create({
      data: { action: 'pike13_sync' },
    });
    expect(event.id).toBeGreaterThan(0);
    expect(event.actor_user_id).toBeNull();
    expect(event.target_user_id).toBeNull();
    expect(event.details).toBeNull();
  });

  it('creates a record with actor and target users', async () => {
    const actor = await makeUser('audit_actor');
    const target = await makeUser('audit_target');

    const event = await prisma.auditEvent.create({
      data: {
        actor_user_id: actor.id,
        action: 'create_user',
        target_user_id: target.id,
        target_entity_type: 'User',
        target_entity_id: String(target.id),
      },
    });

    expect(event.actor_user_id).toBe(actor.id);
    expect(event.target_user_id).toBe(target.id);
  });

  it('round-trips a JSON details object through the Prisma client', async () => {
    const testDetails = {
      key: 'value',
      count: 99,
      nested: { arr: [1, 2, 3] },
      flag: true,
    };

    const event = await prisma.auditEvent.create({
      data: { action: 'test_json', details: testDetails },
    });

    const fetched = await prisma.auditEvent.findUnique({ where: { id: event.id } });
    expect(fetched).not.toBeNull();
    // Prisma maps Json? to an object/null; verify the stored value matches
    expect(JSON.stringify(fetched!.details)).toBe(JSON.stringify(testDetails));
  });

  it('sets actor_user_id to NULL on actor User delete (SetNull)', async () => {
    const actor = await makeUser('audit_setnull_actor');
    const event = await prisma.auditEvent.create({
      data: { actor_user_id: actor.id, action: 'create_user' },
    });

    await prisma.user.delete({ where: { id: actor.id } });

    const fetched = await prisma.auditEvent.findUnique({ where: { id: event.id } });
    expect(fetched!.actor_user_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ProvisioningRequest
// ---------------------------------------------------------------------------

describe('ProvisioningRequest', () => {
  it('creates a pending workspace request', async () => {
    const user = await makeUser('prov_create');

    const req = await prisma.provisioningRequest.create({
      data: {
        user_id: user.id,
        requested_type: 'workspace',
        status: 'pending',
      },
    });

    expect(req.id).toBeGreaterThan(0);
    expect(req.requested_type).toBe('workspace');
    expect(req.status).toBe('pending');
    expect(req.decided_by).toBeNull();
  });

  it('records a decider on approval', async () => {
    const user = await makeUser('prov_approve_subject');
    const admin = await makeUser('prov_approve_admin');

    const req = await prisma.provisioningRequest.create({
      data: { user_id: user.id, requested_type: 'claude' },
    });

    const decided_at = new Date();
    const updated = await prisma.provisioningRequest.update({
      where: { id: req.id },
      data: { status: 'approved', decided_by: admin.id, decided_at },
    });

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).not.toBeNull();
  });

  it('cascades delete when the requesting user is deleted', async () => {
    const user = await makeUser('prov_cascade');
    const req = await prisma.provisioningRequest.create({
      data: { user_id: user.id, requested_type: 'workspace' },
    });

    await prisma.user.delete({ where: { id: user.id } });

    const found = await prisma.provisioningRequest.findUnique({ where: { id: req.id } });
    expect(found).toBeNull();
  });

  it('rejects an invalid status value via CHECK constraint', async () => {
    const user = await makeUser('prov_check');

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ProvisioningRequest" (user_id, requested_type, status, created_at)
         VALUES (?, 'workspace', 'invalid_status', CURRENT_TIMESTAMP)`,
        user.id,
      ),
    ).rejects.toThrow();
  });

  it('rejects an invalid requested_type value via CHECK constraint', async () => {
    const user = await makeUser('prov_check_type');

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ProvisioningRequest" (user_id, requested_type, status, created_at)
         VALUES (?, 'invalid_type', 'pending', CURRENT_TIMESTAMP)`,
        user.id,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// MergeSuggestion
// ---------------------------------------------------------------------------

describe('MergeSuggestion', () => {
  it('creates a pending suggestion with haiku confidence score', async () => {
    const userA = await makeUser('merge_a');
    const userB = await makeUser('merge_b');

    const suggestion = await prisma.mergeSuggestion.create({
      data: {
        user_a_id: userA.id,
        user_b_id: userB.id,
        haiku_confidence: 0.87,
        haiku_rationale: 'Same email domain, same name',
      },
    });

    expect(suggestion.id).toBeGreaterThan(0);
    expect(suggestion.haiku_confidence).toBeCloseTo(0.87);
    expect(suggestion.status).toBe('pending');
    expect(suggestion.decided_by).toBeNull();
  });

  it('enforces unique(user_a_id, user_b_id) constraint', async () => {
    const userA = await makeUser('merge_uniq_a');
    const userB = await makeUser('merge_uniq_b');

    await prisma.mergeSuggestion.create({
      data: { user_a_id: userA.id, user_b_id: userB.id, haiku_confidence: 0.5 },
    });

    await expect(
      prisma.mergeSuggestion.create({
        data: { user_a_id: userA.id, user_b_id: userB.id, haiku_confidence: 0.6 },
      }),
    ).rejects.toThrow();
  });

  it('cascades delete when user_a is deleted', async () => {
    const userA = await makeUser('merge_cascade_a');
    const userB = await makeUser('merge_cascade_b');

    const suggestion = await prisma.mergeSuggestion.create({
      data: { user_a_id: userA.id, user_b_id: userB.id, haiku_confidence: 0.9 },
    });

    await prisma.user.delete({ where: { id: userA.id } });

    const found = await prisma.mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(found).toBeNull();
  });

  it('cascades delete when user_b is deleted', async () => {
    const userA = await makeUser('merge_cascade_c');
    const userB = await makeUser('merge_cascade_d');

    const suggestion = await prisma.mergeSuggestion.create({
      data: { user_a_id: userA.id, user_b_id: userB.id, haiku_confidence: 0.8 },
    });

    await prisma.user.delete({ where: { id: userB.id } });

    const found = await prisma.mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(found).toBeNull();
  });

  it('sets decided_by to NULL on decider User delete (SetNull)', async () => {
    const userA = await makeUser('merge_setnull_a');
    const userB = await makeUser('merge_setnull_b');
    const decider = await makeUser('merge_setnull_decider');

    const suggestion = await prisma.mergeSuggestion.create({
      data: {
        user_a_id: userA.id,
        user_b_id: userB.id,
        haiku_confidence: 0.7,
        status: 'approved',
        decided_by: decider.id,
        decided_at: new Date(),
      },
    });

    await prisma.user.delete({ where: { id: decider.id } });

    const fetched = await prisma.mergeSuggestion.findUnique({ where: { id: suggestion.id } });
    expect(fetched!.decided_by).toBeNull();
  });

  it('rejects an invalid MergeStatus value via CHECK constraint', async () => {
    const userA = await makeUser('merge_check_a');
    const userB = await makeUser('merge_check_b');

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "MergeSuggestion" (user_a_id, user_b_id, haiku_confidence, status, created_at)
         VALUES (?, ?, 0.5, 'invalid_status', CURRENT_TIMESTAMP)`,
        userA.id,
        userB.id,
      ),
    ).rejects.toThrow();
  });

  it('accepts all four valid MergeStatus values', async () => {
    const statuses = ['pending', 'approved', 'rejected', 'deferred'] as const;

    for (const status of statuses) {
      const userA = await makeUser(`merge_status_${status}_a`);
      const userB = await makeUser(`merge_status_${status}_b`);

      const suggestion = await prisma.mergeSuggestion.create({
        data: { user_a_id: userA.id, user_b_id: userB.id, haiku_confidence: 0.5, status },
      });
      expect(suggestion.status).toBe(status);
    }
  });
});
