/**
 * Integration tests for CohortRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import { makeCohort } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Delete in FK-safe order:
  // Login and ExternalAccount use onDelete: Restrict → must go before User.
  // ProvisioningRequest and MergeSuggestion use Cascade, but explicit deletion
  // avoids surprises across test files sharing the same SQLite database.
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
});

// ---------------------------------------------------------------------------
// create + findById (hit)
// ---------------------------------------------------------------------------

describe('CohortRepository.create', () => {
  it('inserts a cohort and returns the created row', async () => {
    const cohort = await CohortRepository.create(prisma, {
      name: 'Alpha Cohort',
      google_ou_path: '/League/Alpha',
    });

    expect(cohort.id).toBeGreaterThan(0);
    expect(cohort.name).toBe('Alpha Cohort');
    expect(cohort.google_ou_path).toBe('/League/Alpha');
    expect(cohort.created_at).toBeInstanceOf(Date);
  });

  it('creates a cohort without a google_ou_path (nullable field)', async () => {
    const cohort = await CohortRepository.create(prisma, { name: 'No OU Cohort' });
    expect(cohort.google_ou_path).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('CohortRepository.findById', () => {
  it('returns the cohort when found', async () => {
    const created = await makeCohort({ name: 'Find Me' });
    const found = await CohortRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Find Me');
  });

  it('returns null when not found', async () => {
    const result = await CohortRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByName
// ---------------------------------------------------------------------------

describe('CohortRepository.findByName', () => {
  it('returns the cohort matching the name', async () => {
    await makeCohort({ name: 'ByName Cohort' });
    const found = await CohortRepository.findByName(prisma, 'ByName Cohort');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('ByName Cohort');
  });

  it('returns null when name does not exist', async () => {
    const result = await CohortRepository.findByName(prisma, 'Nonexistent Cohort');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('CohortRepository.findAll', () => {
  it('returns all cohorts ordered by name ascending', async () => {
    await makeCohort({ name: 'Zeta' });
    await makeCohort({ name: 'Alpha' });
    await makeCohort({ name: 'Mu' });

    const all = await CohortRepository.findAll(prisma);
    const names = all.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it('returns an empty array when no cohorts exist', async () => {
    const all = await CohortRepository.findAll(prisma);
    expect(all).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('CohortRepository.update', () => {
  it('updates the name and google_ou_path fields', async () => {
    const cohort = await makeCohort({ name: 'Before Update' });

    const updated = await CohortRepository.update(prisma, cohort.id, {
      name: 'After Update',
      google_ou_path: '/New/Path',
    });

    expect(updated.name).toBe('After Update');
    expect(updated.google_ou_path).toBe('/New/Path');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('CohortRepository.delete', () => {
  it('deletes the cohort and a subsequent findById returns null', async () => {
    const cohort = await makeCohort({ name: 'To Delete' });
    await CohortRepository.delete(prisma, cohort.id);
    const found = await CohortRepository.findById(prisma, cohort.id);
    expect(found).toBeNull();
  });

  it('throws when the cohort does not exist', async () => {
    await expect(CohortRepository.delete(prisma, 999_999)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unique constraint — duplicate name
// ---------------------------------------------------------------------------

describe('Cohort unique name constraint', () => {
  it('throws a Prisma error when a duplicate name is inserted', async () => {
    await makeCohort({ name: 'Duplicate Name' });
    await expect(
      CohortRepository.create(prisma, { name: 'Duplicate Name' }),
    ).rejects.toThrow();
  });
});
