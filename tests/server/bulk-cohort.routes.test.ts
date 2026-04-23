/**
 * Integration tests for admin bulk-cohort routes (Sprint 008 T002).
 *
 *   GET  /api/admin/cohorts/:id/bulk-preview
 *   POST /api/admin/cohorts/:id/bulk-suspend
 *   POST /api/admin/cohorts/:id/bulk-remove
 *
 * BulkCohortService is replaced with a fake via `registry.bulkCohort` so that
 * these tests exercise the route logic (auth, validation, status codes,
 * response shape) without needing real Google/Claude external accounts.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { NotFoundError } from '../../server/src/errors';
import type { BulkOperationResult } from '../../server/src/services/bulk-cohort.service';

// =============================================================================
// Fake BulkCohortService
// =============================================================================

/** Controls what the fake service returns per test. */
const fakeState = {
  previewCount: 3,
  suspendResult: { succeeded: [1, 2, 3], failed: [] } as BulkOperationResult,
  removeResult: { succeeded: [1, 2, 3], failed: [] } as BulkOperationResult,
  throwNotFound: false,
};

const fakeBulkCohort = {
  previewCount: vi.fn(async (_cohortId: number, _accountType: string, _operation: string) => {
    if (fakeState.throwNotFound) throw new NotFoundError('Cohort 999 not found');
    return fakeState.previewCount;
  }),
  suspendCohort: vi.fn(async (_cohortId: number, _accountType: string, _actorId: number) => {
    if (fakeState.throwNotFound) throw new NotFoundError('Cohort 999 not found');
    return fakeState.suspendResult;
  }),
  removeCohort: vi.fn(async (_cohortId: number, _accountType: string, _actorId: number) => {
    if (fakeState.throwNotFound) throw new NotFoundError('Cohort 999 not found');
    return fakeState.removeResult;
  }),
  suspendAllInCohort: vi.fn(async (_cohortId: number, _actorId: number) => {
    if (fakeState.throwNotFound) throw new NotFoundError('Cohort 999 not found');
    return fakeState.suspendResult;
  }),
  removeAllInCohort: vi.fn(async (_cohortId: number, _actorId: number) => {
    if (fakeState.throwNotFound) throw new NotFoundError('Cohort 999 not found');
    return fakeState.removeResult;
  }),
};

// =============================================================================
// Setup
// =============================================================================

let adminAgent: ReturnType<typeof request.agent>;
let originalBulkCohort: typeof registry.bulkCohort;

beforeAll(async () => {
  // Swap in the fake service
  originalBulkCohort = registry.bulkCohort;
  (registry as any).bulkCohort = fakeBulkCohort;

  // Log in as admin
  adminAgent = request.agent(app);
  await adminAgent.post('/api/auth/test-login').send({
    email: 'bulk-cohort-admin@example.com',
    displayName: 'Bulk Cohort Admin',
    role: 'ADMIN',
  });
}, 30000);

afterAll(async () => {
  // Restore original service
  (registry as any).bulkCohort = originalBulkCohort;
});

beforeEach(() => {
  // Reset fake state to defaults
  fakeState.previewCount = 3;
  fakeState.suspendResult = { succeeded: [1, 2, 3], failed: [] };
  fakeState.removeResult = { succeeded: [1, 2, 3], failed: [] };
  fakeState.throwNotFound = false;
  vi.clearAllMocks();
});

// =============================================================================
// GET /api/admin/cohorts/:id/bulk-preview
// =============================================================================

describe('GET /api/admin/cohorts/:id/bulk-preview', () => {
  it('returns 200 with eligibleCount on happy path', async () => {
    fakeState.previewCount = 5;
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligibleCount: 5 });
    expect(fakeBulkCohort.previewCount).toHaveBeenCalledWith(10, 'workspace', 'suspend');
  });

  it('returns 200 with eligibleCount=0 when no eligible accounts', async () => {
    fakeState.previewCount = 0;
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'claude', operation: 'remove' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eligibleCount: 0 });
  });

  it('returns 400 when accountType is missing', async () => {
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ operation: 'suspend' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when accountType is invalid', async () => {
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'github', operation: 'suspend' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when operation is missing', async () => {
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'workspace' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when operation is invalid', async () => {
    const res = await adminAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'workspace', operation: 'delete' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when cohort does not exist', async () => {
    fakeState.throwNotFound = true;
    const res = await adminAgent
      .get('/api/admin/cohorts/999/bulk-preview')
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'bulk-cohort-user@example.com',
      displayName: 'Bulk Cohort User',
      role: 'USER',
    });
    const res = await userAgent
      .get('/api/admin/cohorts/10/bulk-preview')
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// POST /api/admin/cohorts/:id/bulk-suspend
// =============================================================================

describe('POST /api/admin/cohorts/:id/bulk-suspend', () => {
  it('returns 200 with result when all accounts succeed', async () => {
    fakeState.suspendResult = { succeeded: [1, 2, 3], failed: [] };
    const res = await adminAgent
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([1, 2, 3]);
    expect(res.body.failed).toEqual([]);
    expect(fakeBulkCohort.suspendCohort).toHaveBeenCalledWith(10, 'workspace', expect.any(Number));
  });

  it('returns 200 when zero eligible accounts (empty succeeded and failed)', async () => {
    fakeState.suspendResult = { succeeded: [], failed: [] };
    const res = await adminAgent
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({ accountType: 'claude' });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([]);
    expect(res.body.failed).toEqual([]);
  });

  it('returns 207 when at least one account fails and at least one succeeds', async () => {
    fakeState.suspendResult = {
      succeeded: [1, 2],
      failed: [
        { accountId: 3, userId: 7, userName: 'Alice', error: 'API timeout' },
      ],
    };
    const res = await adminAgent
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(207);
    expect(res.body.succeeded).toEqual([1, 2]);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0]).toMatchObject({
      accountId: 3,
      userId: 7,
      userName: 'Alice',
      error: 'API timeout',
    });
  });

  it('returns 400 when accountType is missing', async () => {
    const res = await adminAgent
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when accountType is invalid', async () => {
    const res = await adminAgent
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({ accountType: 'pike13' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when cohort does not exist', async () => {
    fakeState.throwNotFound = true;
    const res = await adminAgent
      .post('/api/admin/cohorts/999/bulk-suspend')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/admin/cohorts/10/bulk-suspend')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/admin/cohorts/:id/bulk-remove
// =============================================================================

describe('POST /api/admin/cohorts/:id/bulk-remove', () => {
  it('returns 200 with result when all accounts succeed', async () => {
    fakeState.removeResult = { succeeded: [4, 5], failed: [] };
    const res = await adminAgent
      .post('/api/admin/cohorts/20/bulk-remove')
      .send({ accountType: 'claude' });

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([4, 5]);
    expect(res.body.failed).toEqual([]);
    expect(fakeBulkCohort.removeCohort).toHaveBeenCalledWith(20, 'claude', expect.any(Number));
  });

  it('returns 207 when partial failure occurs', async () => {
    fakeState.removeResult = {
      succeeded: [4],
      failed: [
        { accountId: 5, userId: 9, userName: 'Bob', error: 'Not found in provider' },
      ],
    };
    const res = await adminAgent
      .post('/api/admin/cohorts/20/bulk-remove')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(207);
    expect(res.body.succeeded).toEqual([4]);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].accountId).toBe(5);
  });

  it('returns 400 when accountType is missing', async () => {
    const res = await adminAgent
      .post('/api/admin/cohorts/20/bulk-remove')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when accountType is invalid', async () => {
    const res = await adminAgent
      .post('/api/admin/cohorts/20/bulk-remove')
      .send({ accountType: 'github' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when cohort does not exist', async () => {
    fakeState.throwNotFound = true;
    const res = await adminAgent
      .post('/api/admin/cohorts/999/bulk-remove')
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app)
      .post('/api/admin/cohorts/20/bulk-remove')
      .send({ accountType: 'claude' });

    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /admin/cohorts/:id/bulk-suspend-all
// =============================================================================

describe('POST /api/admin/cohorts/:id/bulk-suspend-all', () => {
  it('returns 200 with service result on success', async () => {
    fakeState.suspendResult = {
      succeeded: [10, 11, 12],
      failed: [],
    } as BulkOperationResult;

    const res = await adminAgent.post('/api/admin/cohorts/5/bulk-suspend-all');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [10, 11, 12], failed: [] });
    expect(fakeBulkCohort.suspendAllInCohort).toHaveBeenCalledWith(5, expect.any(Number));
  });

  it('returns 207 on partial failure', async () => {
    fakeState.suspendResult = {
      succeeded: [10],
      failed: [
        {
          accountId: 11,
          userId: 21,
          userName: 'Bob',
          type: 'claude',
          error: 'rate limited',
        },
      ],
    } as BulkOperationResult;

    const res = await adminAgent.post('/api/admin/cohorts/5/bulk-suspend-all');

    expect(res.status).toBe(207);
    expect(res.body.failed[0].type).toBe('claude');
  });

  it('returns 404 when cohort does not exist', async () => {
    fakeState.throwNotFound = true;
    const res = await adminAgent.post('/api/admin/cohorts/999/bulk-suspend-all');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid cohort id', async () => {
    const res = await adminAgent.post('/api/admin/cohorts/abc/bulk-suspend-all');
    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).post('/api/admin/cohorts/5/bulk-suspend-all');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /admin/cohorts/:id/bulk-remove-all
// =============================================================================

describe('POST /api/admin/cohorts/:id/bulk-remove-all', () => {
  it('returns 200 with service result on success', async () => {
    fakeState.removeResult = {
      succeeded: [20, 21],
      failed: [],
    } as BulkOperationResult;

    const res = await adminAgent.post('/api/admin/cohorts/7/bulk-remove-all');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [20, 21], failed: [] });
    expect(fakeBulkCohort.removeAllInCohort).toHaveBeenCalledWith(7, expect.any(Number));
  });

  it('returns 207 on partial failure', async () => {
    fakeState.removeResult = {
      succeeded: [20],
      failed: [
        {
          accountId: 21,
          userId: 42,
          userName: 'Carol',
          type: 'workspace',
          error: 'upstream 502',
        },
      ],
    } as BulkOperationResult;

    const res = await adminAgent.post('/api/admin/cohorts/7/bulk-remove-all');
    expect(res.status).toBe(207);
    expect(res.body.failed[0].type).toBe('workspace');
  });

  it('returns 404 when cohort does not exist', async () => {
    fakeState.throwNotFound = true;
    const res = await adminAgent.post('/api/admin/cohorts/999/bulk-remove-all');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid cohort id', async () => {
    const res = await adminAgent.post('/api/admin/cohorts/abc/bulk-remove-all');
    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await request(app).post('/api/admin/cohorts/7/bulk-remove-all');
    expect(res.status).toBe(401);
  });
});
