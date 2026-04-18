/**
 * Integration tests for MergeSuggestionRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { MergeSuggestionRepository } from '../../../server/src/services/repositories/merge-suggestion.repository.js';
import { makeUser, makeMergeSuggestion } from '../helpers/factories.js';

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

describe('MergeSuggestionRepository.create', () => {
  it('inserts a pending merge suggestion and returns the created row', async () => {
    const userA = await makeUser();
    const userB = await makeUser();

    const suggestion = await MergeSuggestionRepository.create(prisma, {
      user_a_id: userA.id,
      user_b_id: userB.id,
      haiku_confidence: 0.87,
      haiku_rationale: 'Same email domain',
    });

    expect(suggestion.id).toBeGreaterThan(0);
    expect(suggestion.user_a_id).toBe(userA.id);
    expect(suggestion.user_b_id).toBe(userB.id);
    expect(suggestion.haiku_confidence).toBeCloseTo(0.87);
    expect(suggestion.haiku_rationale).toBe('Same email domain');
    expect(suggestion.status).toBe('pending');
    expect(suggestion.decided_by).toBeNull();
    expect(suggestion.created_at).toBeInstanceOf(Date);
  });

  it('creates a suggestion with an explicit status', async () => {
    const userA = await makeUser();
    const userB = await makeUser();

    const suggestion = await MergeSuggestionRepository.create(prisma, {
      user_a_id: userA.id,
      user_b_id: userB.id,
      haiku_confidence: 0.5,
      status: 'deferred',
    });
    expect(suggestion.status).toBe('deferred');
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('MergeSuggestionRepository.findById', () => {
  it('returns the suggestion when found', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const created = await makeMergeSuggestion(userA, userB, { haiku_confidence: 0.6 });
    const found = await MergeSuggestionRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null when not found', async () => {
    const result = await MergeSuggestionRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findPending
// ---------------------------------------------------------------------------

describe('MergeSuggestionRepository.findPending', () => {
  it('returns only pending suggestions in FIFO order', async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    const u4 = await makeUser();

    const s1 = await makeMergeSuggestion(u1, u2, { status: 'pending' });
    const s2 = await makeMergeSuggestion(u3, u4, { status: 'pending' });
    await makeMergeSuggestion(u1, u3, { status: 'approved' });

    const pending = await MergeSuggestionRepository.findPending(prisma);
    expect(pending.length).toBe(2);
    expect(pending.every((s) => s.status === 'pending')).toBe(true);
    expect(pending[0].id).toBe(s1.id);
    expect(pending[1].id).toBe(s2.id);
  });
});

// ---------------------------------------------------------------------------
// findByPair
// ---------------------------------------------------------------------------

describe('MergeSuggestionRepository.findByPair', () => {
  it('returns the suggestion for the exact pair', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await makeMergeSuggestion(userA, userB);

    const found = await MergeSuggestionRepository.findByPair(prisma, userA.id, userB.id);
    expect(found).not.toBeNull();
    expect(found!.user_a_id).toBe(userA.id);
    expect(found!.user_b_id).toBe(userB.id);
  });

  it('returns null when the pair does not exist', async () => {
    const result = await MergeSuggestionRepository.findByPair(prisma, 999_998, 999_999);
    expect(result).toBeNull();
  });

  it('does not match when pair order is reversed (callers must canonicalise)', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await makeMergeSuggestion(userA, userB);

    // Reversed lookup — should return null because (B, A) was never inserted
    const found = await MergeSuggestionRepository.findByPair(prisma, userB.id, userA.id);
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('MergeSuggestionRepository.updateStatus', () => {
  it('approves a suggestion with decided_by and decided_at', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const decider = await makeUser();
    const suggestion = await makeMergeSuggestion(userA, userB);
    const decidedAt = new Date();

    const updated = await MergeSuggestionRepository.updateStatus(
      prisma,
      suggestion.id,
      'approved',
      decider.id,
      decidedAt,
    );

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(decider.id);
    expect(updated.decided_at).not.toBeNull();
  });

  it('rejects a suggestion with null decided_by', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const suggestion = await makeMergeSuggestion(userA, userB);

    const updated = await MergeSuggestionRepository.updateStatus(
      prisma,
      suggestion.id,
      'rejected',
    );

    expect(updated.status).toBe('rejected');
    expect(updated.decided_by).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unique constraint — (user_a_id, user_b_id)
// ---------------------------------------------------------------------------

describe('MergeSuggestion unique pair constraint', () => {
  it('throws when the same pair is inserted twice', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    await makeMergeSuggestion(userA, userB);

    await expect(
      MergeSuggestionRepository.create(prisma, {
        user_a_id: userA.id,
        user_b_id: userB.id,
        haiku_confidence: 0.9,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FK constraint — Cascade delete
// ---------------------------------------------------------------------------

describe('MergeSuggestion FK cascade', () => {
  it('cascades delete when user_a is deleted', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const suggestion = await makeMergeSuggestion(userA, userB);

    await (prisma as any).user.delete({ where: { id: userA.id } });

    const found = await MergeSuggestionRepository.findById(prisma, suggestion.id);
    expect(found).toBeNull();
  });

  it('cascades delete when user_b is deleted', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const suggestion = await makeMergeSuggestion(userA, userB);

    await (prisma as any).user.delete({ where: { id: userB.id } });

    const found = await MergeSuggestionRepository.findById(prisma, suggestion.id);
    expect(found).toBeNull();
  });

  it('sets decided_by to null when the decider User is deleted (SetNull)', async () => {
    const userA = await makeUser();
    const userB = await makeUser();
    const decider = await makeUser();
    const suggestion = await makeMergeSuggestion(userA, userB, {
      status: 'approved',
      decided_by: decider.id,
      decided_at: new Date(),
    });

    await (prisma as any).user.delete({ where: { id: decider.id } });

    const fetched = await MergeSuggestionRepository.findById(prisma, suggestion.id);
    expect(fetched!.decided_by).toBeNull();
  });
});
