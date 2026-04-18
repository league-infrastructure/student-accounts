/**
 * Integration tests for AuditEventRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditEventRepository } from '../../../server/src/services/repositories/audit-event.repository.js';
import { makeUser, makeAuditEvent } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Delete in FK-safe order across all domain tables.
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
});

// ---------------------------------------------------------------------------
// create + findById (hit)
// ---------------------------------------------------------------------------

describe('AuditEventRepository.create', () => {
  it('inserts a system event (no actor or target)', async () => {
    const event = await AuditEventRepository.create(prisma, { action: 'pike13_sync' });
    expect(event.id).toBeGreaterThan(0);
    expect(event.action).toBe('pike13_sync');
    expect(event.actor_user_id).toBeNull();
    expect(event.target_user_id).toBeNull();
    expect(event.details).toBeNull();
    expect(event.created_at).toBeInstanceOf(Date);
  });

  it('inserts an event with actor, target, and JSON details', async () => {
    const actor = await makeUser();
    const target = await makeUser();

    const event = await AuditEventRepository.create(prisma, {
      actor_user_id: actor.id,
      action: 'create_user',
      target_user_id: target.id,
      target_entity_type: 'User',
      target_entity_id: String(target.id),
      details: { role: 'student', source: 'admin' },
    });

    expect(event.actor_user_id).toBe(actor.id);
    expect(event.target_user_id).toBe(target.id);
    expect(event.target_entity_type).toBe('User');
    // JSON round-trip
    expect(JSON.stringify(event.details)).toBe(JSON.stringify({ role: 'student', source: 'admin' }));
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('AuditEventRepository.findById', () => {
  it('returns the event when found', async () => {
    const created = await makeAuditEvent({ action: 'add_login' });
    const found = await AuditEventRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.action).toBe('add_login');
  });

  it('returns null when not found', async () => {
    const result = await AuditEventRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByTargetUser
// ---------------------------------------------------------------------------

describe('AuditEventRepository.findByTargetUser', () => {
  it('returns events where the user is the target, newest first', async () => {
    const target = await makeUser();
    const other = await makeUser();

    // Create events for target
    await makeAuditEvent({ target_user_id: target.id, action: 'create_user' });
    await makeAuditEvent({ target_user_id: target.id, action: 'assign_cohort' });
    // Create event for another user
    await makeAuditEvent({ target_user_id: other.id, action: 'create_user' });

    const events = await AuditEventRepository.findByTargetUser(prisma, target.id);
    expect(events.length).toBe(2);
    expect(events.every((e) => e.target_user_id === target.id)).toBe(true);
  });

  it('respects the limit parameter', async () => {
    const target = await makeUser();
    for (let i = 0; i < 5; i++) {
      await makeAuditEvent({ target_user_id: target.id, action: 'create_user' });
    }
    const events = await AuditEventRepository.findByTargetUser(prisma, target.id, 3);
    expect(events.length).toBe(3);
  });

  it('returns an empty array when no events match', async () => {
    const user = await makeUser();
    const events = await AuditEventRepository.findByTargetUser(prisma, user.id);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findByActor
// ---------------------------------------------------------------------------

describe('AuditEventRepository.findByActor', () => {
  it('returns events where the user is the actor', async () => {
    const actor = await makeUser();
    await makeAuditEvent({ actor_user_id: actor.id, action: 'create_user' });
    await makeAuditEvent({ actor_user_id: actor.id, action: 'assign_cohort' });

    const events = await AuditEventRepository.findByActor(prisma, actor.id);
    expect(events.length).toBe(2);
    expect(events.every((e) => e.actor_user_id === actor.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findByAction
// ---------------------------------------------------------------------------

describe('AuditEventRepository.findByAction', () => {
  it('returns events matching the action string', async () => {
    await makeAuditEvent({ action: 'provision_workspace' });
    await makeAuditEvent({ action: 'provision_workspace' });
    await makeAuditEvent({ action: 'create_user' });

    const events = await AuditEventRepository.findByAction(prisma, 'provision_workspace');
    expect(events.length).toBe(2);
    expect(events.every((e) => e.action === 'provision_workspace')).toBe(true);
  });

  it('returns an empty array when no events match the action', async () => {
    const events = await AuditEventRepository.findByAction(prisma, 'nonexistent_action');
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SetNull behaviour on actor/target deletion
// ---------------------------------------------------------------------------

describe('AuditEvent FK SetNull', () => {
  it('sets actor_user_id to null when actor User is deleted', async () => {
    const actor = await makeUser();
    const event = await AuditEventRepository.create(prisma, {
      actor_user_id: actor.id,
      action: 'create_user',
    });

    await (prisma as any).user.delete({ where: { id: actor.id } });

    const fetched = await AuditEventRepository.findById(prisma, event.id);
    expect(fetched!.actor_user_id).toBeNull();
  });

  it('sets target_user_id to null when target User is deleted', async () => {
    const target = await makeUser();
    const event = await AuditEventRepository.create(prisma, {
      action: 'create_user',
      target_user_id: target.id,
    });

    await (prisma as any).user.delete({ where: { id: target.id } });

    const fetched = await AuditEventRepository.findById(prisma, event.id);
    expect(fetched!.target_user_id).toBeNull();
  });
});
