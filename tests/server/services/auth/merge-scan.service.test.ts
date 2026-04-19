/**
 * Integration / unit tests for mergeScanWithDeps (Sprint 007 T003).
 *
 * Uses a real SQLite test DB and FakeHaikuClient.
 *
 * Covers:
 *  - Happy path: new user with 2 candidates → HaikuClient called twice,
 *    MergeSuggestion rows created for each pair above threshold.
 *  - Low confidence: confidence < 0.6 → no row created.
 *  - Staff user: no HaikuClient calls, no rows.
 *  - No candidates: no HaikuClient calls, no rows.
 *  - HaikuApiError thrown → no crash; scan continues for remaining pairs.
 *  - Duplicate pair (unique constraint) → caught silently; scan continues.
 *  - AuditEvent with action=merge_suggestion_created written for each row.
 *  - MERGE_SCAN_CONFIDENCE_THRESHOLD env var overrides the 0.6 default.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { mergeScanWithDeps } from '../../../../server/src/services/auth/merge-scan.service.js';
import { HaikuApiError } from '../../../../server/src/services/merge/haiku.client.js';
import { FakeHaikuClient } from '../../helpers/fake-haiku.client.js';
import { makeUser } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// DB cleanup
// ---------------------------------------------------------------------------

async function clearDb(): Promise<void> {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const audit = new AuditService();

async function countMergeSuggestions(): Promise<number> {
  return (prisma as any).mergeSuggestion.count();
}

async function countAuditEvents(action: string): Promise<number> {
  return (prisma as any).auditEvent.count({ where: { action } });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fake: FakeHaikuClient;

beforeEach(async () => {
  await clearDb();
  fake = new FakeHaikuClient();
  delete process.env.MERGE_SCAN_CONFIDENCE_THRESHOLD;
});

afterAll(async () => {
  await clearDb();
  delete process.env.MERGE_SCAN_CONFIDENCE_THRESHOLD;
});

// ---------------------------------------------------------------------------
// Staff user — skip entirely
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — staff user', () => {
  it('makes no HaikuClient calls and creates no rows for role=staff', async () => {
    // Create an existing student to serve as a potential candidate
    await makeUser({ primary_email: 'existing@example.com', role: 'student' });

    const staffUser = await makeUser({ primary_email: 'staff@example.com', role: 'staff' });

    await mergeScanWithDeps(staffUser, prisma, fake, audit);

    expect(fake.calls).toHaveLength(0);
    expect(await countMergeSuggestions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// No candidates — skip entirely
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — no candidates', () => {
  it('makes no HaikuClient calls when no other users exist', async () => {
    const newUser = await makeUser({ primary_email: 'lone@example.com', role: 'student' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(fake.calls).toHaveLength(0);
    expect(await countMergeSuggestions()).toBe(0);
  });

  it('excludes the new user itself when counting candidates', async () => {
    const onlyUser = await makeUser({ primary_email: 'only@example.com', role: 'student' });

    await mergeScanWithDeps(onlyUser, prisma, fake, audit);

    expect(fake.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Happy path — high confidence
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — high confidence pairs', () => {
  it('calls HaikuClient.evaluate twice for a new user with 2 candidates', async () => {
    const userA = await makeUser({ primary_email: 'a@example.com', role: 'student' });
    const userB = await makeUser({ primary_email: 'b@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'new@example.com', role: 'student' });

    fake.configure({ confidence: 0.8, rationale: 'Same person.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(fake.calls).toHaveLength(2);

    // Both calls should involve the new user's snapshot on one side
    const callUserIds = fake.calls.flatMap((c) => [c.userA.id, c.userB.id]);
    expect(callUserIds).toContain(newUser.id);
    expect(callUserIds).toContain(userA.id);
    expect(callUserIds).toContain(userB.id);
  });

  it('creates MergeSuggestion rows for all pairs above threshold', async () => {
    const userA = await makeUser({ primary_email: 'alpha@example.com', role: 'student' });
    const userB = await makeUser({ primary_email: 'beta@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'gamma@example.com', role: 'student' });

    fake.configure({ confidence: 0.85, rationale: 'High similarity.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(2);

    // Verify pair order: lower id first
    const suggestions = await (prisma as any).mergeSuggestion.findMany({
      orderBy: { id: 'asc' },
    });
    for (const s of suggestions) {
      expect(s.user_a_id).toBeLessThan(s.user_b_id);
      expect(s.haiku_confidence).toBe(0.85);
      expect(s.haiku_rationale).toBe('High similarity.');
      expect(s.status).toBe('pending');
    }
  });

  it('writes merge_suggestion_created AuditEvent for each row', async () => {
    await makeUser({ primary_email: 'x@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'y@example.com', role: 'student' });

    fake.configure({ confidence: 0.9, rationale: 'Very likely.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countAuditEvents('merge_suggestion_created')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Exactly at threshold — 0.6 should create a row
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — threshold boundary', () => {
  it('creates a row when confidence is exactly 0.6 (>= threshold)', async () => {
    await makeUser({ primary_email: 'existing@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'boundary@example.com', role: 'student' });

    fake.configure({ confidence: 0.6, rationale: 'At threshold.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(1);
  });

  it('does not create a row when confidence is 0.59 (below threshold)', async () => {
    await makeUser({ primary_email: 'existing@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'below@example.com', role: 'student' });

    fake.configure({ confidence: 0.59, rationale: 'Below threshold.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Low confidence — no rows
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — low confidence', () => {
  it('creates no MergeSuggestion row when confidence < 0.6', async () => {
    await makeUser({ primary_email: 'old@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'newer@example.com', role: 'student' });

    // FakeHaikuClient default returns confidence 0.5
    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(0);
    expect(await countAuditEvents('merge_suggestion_created')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HaikuApiError — caught per-pair; scan continues
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — HaikuApiError resilience', () => {
  it('catches HaikuApiError per pair and continues scan without throwing', async () => {
    const userA = await makeUser({ primary_email: 'error-a@example.com', role: 'student' });
    const userB = await makeUser({ primary_email: 'error-b@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'error-new@example.com', role: 'student' });

    // Throw on first call, succeed with high confidence on second
    let callCount = 0;
    const mixedFake = new FakeHaikuClient();
    // We can't configure per-call with FakeHaikuClient, so override evaluate manually
    const originalEvaluate = mixedFake.evaluate.bind(mixedFake);
    (mixedFake as any).evaluate = async (a: any, b: any) => {
      callCount++;
      mixedFake.calls.push({ userA: a, userB: b });
      if (callCount === 1) {
        throw new HaikuApiError('API error on first call');
      }
      return { confidence: 0.9, rationale: 'Second call ok.' };
    };

    // Should not throw even though the first pair errors
    await expect(mergeScanWithDeps(newUser, prisma, mixedFake, audit)).resolves.toBeUndefined();

    // One suggestion should have been created from the second successful call
    expect(await countMergeSuggestions()).toBe(1);
  });

  it('does not roll back User creation when HaikuApiError is thrown', async () => {
    await makeUser({ primary_email: 'resilience@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'resilience-new@example.com', role: 'student' });

    fake.configureError(new HaikuApiError('Haiku API unavailable'));

    // Should not throw
    await expect(mergeScanWithDeps(newUser, prisma, fake, audit)).resolves.toBeUndefined();

    // User still exists
    const userInDb = await (prisma as any).user.findUnique({
      where: { primary_email: 'resilience-new@example.com' },
    });
    expect(userInDb).not.toBeNull();
    expect(await countMergeSuggestions()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Duplicate pair — unique constraint caught silently
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — duplicate pair', () => {
  it('silently skips a pair that already has a MergeSuggestion row', async () => {
    const existing = await makeUser({ primary_email: 'dup-a@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'dup-b@example.com', role: 'student' });

    fake.configure({ confidence: 0.9, rationale: 'Duplicate.' });

    // Create the suggestion first
    const userAId = Math.min(existing.id, newUser.id);
    const userBId = Math.max(existing.id, newUser.id);
    await (prisma as any).mergeSuggestion.create({
      data: { user_a_id: userAId, user_b_id: userBId, haiku_confidence: 0.7, status: 'pending' },
    });

    // Should not throw even though the row already exists
    await expect(mergeScanWithDeps(newUser, prisma, fake, audit)).resolves.toBeUndefined();

    // Still only 1 suggestion row (not 2)
    expect(await countMergeSuggestions()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MERGE_SCAN_CONFIDENCE_THRESHOLD env var
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — MERGE_SCAN_CONFIDENCE_THRESHOLD env var', () => {
  it('respects MERGE_SCAN_CONFIDENCE_THRESHOLD=0.9 — rejects score of 0.7', async () => {
    process.env.MERGE_SCAN_CONFIDENCE_THRESHOLD = '0.9';

    await makeUser({ primary_email: 'high-thresh-existing@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'high-thresh-new@example.com', role: 'student' });

    fake.configure({ confidence: 0.7, rationale: 'Medium confidence.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(0);
  });

  it('respects MERGE_SCAN_CONFIDENCE_THRESHOLD=0.5 — accepts score of 0.6', async () => {
    process.env.MERGE_SCAN_CONFIDENCE_THRESHOLD = '0.5';

    await makeUser({ primary_email: 'low-thresh-existing@example.com', role: 'student' });
    const newUser = await makeUser({ primary_email: 'low-thresh-new@example.com', role: 'student' });

    fake.configure({ confidence: 0.6, rationale: 'Above lower threshold.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    expect(await countMergeSuggestions()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Staff candidates are excluded from scan
// ---------------------------------------------------------------------------

describe('mergeScanWithDeps — staff candidates excluded', () => {
  it('does not include staff users as candidates', async () => {
    await makeUser({ primary_email: 'staff-candidate@example.com', role: 'staff' });
    const newUser = await makeUser({ primary_email: 'student-new@example.com', role: 'student' });

    fake.configure({ confidence: 0.9, rationale: 'High.' });

    await mergeScanWithDeps(newUser, prisma, fake, audit);

    // Staff user should not be a candidate
    expect(fake.calls).toHaveLength(0);
    expect(await countMergeSuggestions()).toBe(0);
  });
});
