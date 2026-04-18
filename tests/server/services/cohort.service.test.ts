/**
 * Integration tests for CohortService.
 *
 * Covers:
 *  - create: creates Cohort + AuditEvent atomically
 *  - findById: returns cohort or throws NotFoundError
 *  - findAll: returns all cohorts
 *  - findByName: returns cohort or null
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { CohortService } from '../../../server/src/services/cohort.service.js';
import { NotFoundError } from '../../../server/src/errors.js';

let cohortService: CohortService;

beforeEach(async () => {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();

  cohortService = new CohortService(prisma, new AuditService());
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('CohortService.create', () => {
  it('creates a Cohort and a create_cohort AuditEvent atomically', async () => {
    const cohort = await cohortService.create({ name: 'Spring 2026' });

    expect(cohort.id).toBeDefined();
    expect(cohort.name).toBe('Spring 2026');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'create_cohort', target_entity_id: String(cohort.id) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_type).toBe('Cohort');
  });

  it('stores google_ou_path when provided', async () => {
    const cohort = await cohortService.create({
      name: 'Fall 2026',
      google_ou_path: '/Students/Fall2026',
    });
    expect(cohort.google_ou_path).toBe('/Students/Fall2026');
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('CohortService.findById', () => {
  it('returns the cohort when it exists', async () => {
    const created = await cohortService.create({ name: 'Test Cohort' });
    const found = await cohortService.findById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('throws NotFoundError for a non-existent id', async () => {
    await expect(cohortService.findById(9999999)).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// findAll
// ---------------------------------------------------------------------------

describe('CohortService.findAll', () => {
  it('returns all cohorts', async () => {
    await cohortService.create({ name: 'Cohort A' });
    await cohortService.create({ name: 'Cohort B' });
    const all = await cohortService.findAll();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// findByName
// ---------------------------------------------------------------------------

describe('CohortService.findByName', () => {
  it('returns the cohort when the name matches', async () => {
    await cohortService.create({ name: 'Named Cohort' });
    const found = await cohortService.findByName('Named Cohort');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Named Cohort');
  });

  it('returns null for an unknown name', async () => {
    const result = await cohortService.findByName('No Such Cohort');
    expect(result).toBeNull();
  });
});
