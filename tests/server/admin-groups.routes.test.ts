/**
 * Integration tests for admin groups routes (Sprint 012 T004).
 *
 * Swaps `registry.groups` and `registry.bulkGroup` with fakes so the tests
 * focus on route behaviour (auth, validation, status codes, response shape).
 * Mirrors the pattern used by `bulk-cohort.routes.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../server/src/errors';
import type { BulkOperationResult } from '../../server/src/services/bulk-account.shared';

// ---------------------------------------------------------------------------
// Fake services
// ---------------------------------------------------------------------------

const state = {
  throwNotFound: false,
  throwConflict: false,
  throwValidation: false,
  bulkResult: { succeeded: [1, 2], failed: [] } as BulkOperationResult,
  userSearchResult: [] as any[],
  listGroupsForUserResult: [] as any[],
  findAllResult: [] as any[],
};

function maybeThrow() {
  if (state.throwNotFound) throw new NotFoundError('not found');
  if (state.throwConflict) throw new ConflictError('dup');
  if (state.throwValidation) throw new ValidationError('blank');
}

const fakeGroups = {
  findAll: vi.fn(async () => state.findAllResult),
  create: vi.fn(async (data: any) => {
    maybeThrow();
    return {
      id: 1,
      name: data.name,
      description: data.description ?? null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };
  }),
  findById: vi.fn(async (id: number) => {
    maybeThrow();
    return {
      id,
      name: 'G',
      description: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      allows_oauth_client: false,
      allows_llm_proxy: false,
      allows_league_account: false,
    };
  }),
  update: vi.fn(async (id: number, data: any) => {
    maybeThrow();
    return {
      id,
      name: data.name ?? 'G',
      description: data.description ?? null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    };
  }),
  delete: vi.fn(async () => {
    maybeThrow();
  }),
  listMembers: vi.fn(async () => ({
    group: { id: 1, name: 'G', description: null, createdAt: new Date() },
    users: [],
  })),
  addMember: vi.fn(async () => {
    maybeThrow();
  }),
  removeMember: vi.fn(async () => {
    maybeThrow();
  }),
  searchUsersNotInGroup: vi.fn(async () => {
    maybeThrow();
    return state.userSearchResult;
  }),
  listGroupsForUser: vi.fn(async () => state.listGroupsForUserResult),
  setPermission: vi.fn(async (id: number, perm: string, value: boolean) => {
    maybeThrow();
    return {
      id,
      name: 'G',
      description: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
      allows_oauth_client: perm === 'oauthClient' ? value : false,
      allows_llm_proxy: perm === 'llmProxy' ? value : false,
      allows_league_account: perm === 'leagueAccount' ? value : false,
    };
  }),
  userPermissions: vi.fn(async () => ({
    oauthClient: false,
    llmProxy: false,
    leagueAccount: false,
  })),
};

const fakeBulkGroup = {
  provisionGroup: vi.fn(async () => {
    maybeThrow();
    return state.bulkResult;
  }),
  suspendAllInGroup: vi.fn(async () => {
    maybeThrow();
    return state.bulkResult;
  }),
  removeAllInGroup: vi.fn(async () => {
    maybeThrow();
    return state.bulkResult;
  }),
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let adminAgent: ReturnType<typeof request.agent>;
let originalGroups: any;
let originalBulkGroup: any;

beforeAll(async () => {
  originalGroups = (registry as any).groups;
  originalBulkGroup = (registry as any).bulkGroup;
  (registry as any).groups = fakeGroups;
  (registry as any).bulkGroup = fakeBulkGroup;

  adminAgent = request.agent(app);
  await adminAgent.post('/api/auth/test-login').send({
    email: 'admin-groups@example.com',
    displayName: 'Admin Groups',
    role: 'ADMIN',
  });
}, 30000);

afterAll(async () => {
  (registry as any).groups = originalGroups;
  (registry as any).bulkGroup = originalBulkGroup;
});

beforeEach(() => {
  state.throwNotFound = false;
  state.throwConflict = false;
  state.throwValidation = false;
  state.bulkResult = { succeeded: [1, 2], failed: [] };
  state.userSearchResult = [];
  state.listGroupsForUserResult = [];
  state.findAllResult = [];
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /admin/groups
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups', () => {
  it('returns summaries (200)', async () => {
    state.findAllResult = [
      { id: 1, name: 'A', description: null, memberCount: 2, createdAt: new Date() },
      { id: 2, name: 'B', description: 'd', memberCount: 0, createdAt: new Date() },
    ];
    const res = await adminAgent.get('/api/admin/groups');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0]).toMatchObject({ id: 1, name: 'A', memberCount: 2 });
  });

  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/admin/groups');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/groups
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups', () => {
  it('201 on success', async () => {
    const res = await adminAgent
      .post('/api/admin/groups')
      .send({ name: 'New', description: 'd' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New');
  });

  it('422 on blank name (ValidationError)', async () => {
    state.throwValidation = true;
    const res = await adminAgent.post('/api/admin/groups').send({ name: '   ' });
    expect(res.status).toBe(422);
  });

  it('422 when name is not a string', async () => {
    const res = await adminAgent.post('/api/admin/groups').send({ name: 123 });
    expect(res.status).toBe(422);
  });

  it('409 on duplicate (ConflictError)', async () => {
    state.throwConflict = true;
    const res = await adminAgent.post('/api/admin/groups').send({ name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/groups/:id
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups/:id', () => {
  it('200 returns group', async () => {
    const res = await adminAgent.get('/api/admin/groups/42');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });

  it('400 on invalid id', async () => {
    const res = await adminAgent.get('/api/admin/groups/abc');
    expect(res.status).toBe(400);
  });

  it('404 when service throws NotFoundError', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.get('/api/admin/groups/42');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /admin/groups/:id
// ---------------------------------------------------------------------------

describe('PUT /api/admin/groups/:id', () => {
  it('200 on update', async () => {
    const res = await adminAgent
      .put('/api/admin/groups/1')
      .send({ name: 'Renamed', description: 'new' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
  });

  it('422 ValidationError bubbles', async () => {
    state.throwValidation = true;
    const res = await adminAgent
      .put('/api/admin/groups/1')
      .send({ name: '  ' });
    expect(res.status).toBe(422);
  });

  it('404 when missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent
      .put('/api/admin/groups/1')
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /admin/groups/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/groups/:id', () => {
  it('204 on success', async () => {
    const res = await adminAgent.delete('/api/admin/groups/1');
    expect(res.status).toBe(204);
  });

  it('404 when missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.delete('/api/admin/groups/1');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Members: GET / POST / DELETE
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups/:id/members', () => {
  it('200 returns members', async () => {
    const res = await adminAgent.get('/api/admin/groups/1/members');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('group');
    expect(res.body).toHaveProperty('users');
  });
});

describe('POST /api/admin/groups/:id/members', () => {
  it('201 on add', async () => {
    const res = await adminAgent
      .post('/api/admin/groups/1/members')
      .send({ userId: 10 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ groupId: 1, userId: 10 });
  });

  it('400 when userId missing', async () => {
    const res = await adminAgent
      .post('/api/admin/groups/1/members')
      .send({});
    expect(res.status).toBe(400);
  });

  it('409 on duplicate', async () => {
    state.throwConflict = true;
    const res = await adminAgent
      .post('/api/admin/groups/1/members')
      .send({ userId: 10 });
    expect(res.status).toBe(409);
  });

  it('404 when group/user missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent
      .post('/api/admin/groups/1/members')
      .send({ userId: 10 });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/admin/groups/:id/members/:userId', () => {
  it('204 on remove', async () => {
    const res = await adminAgent.delete('/api/admin/groups/1/members/10');
    expect(res.status).toBe(204);
  });

  it('404 when not a member', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.delete('/api/admin/groups/1/members/10');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// user-search + /users/:id/groups
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups/:id/user-search', () => {
  it('200 returns matches', async () => {
    state.userSearchResult = [
      { id: 1, displayName: 'A', email: 'a@x', matchedOn: 'display_name' },
    ];
    const res = await adminAgent.get('/api/admin/groups/1/user-search?q=alpha');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });

  it('404 when group missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.get('/api/admin/groups/1/user-search?q=alpha');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/users/:id/groups', () => {
  it('200 returns groups', async () => {
    state.listGroupsForUserResult = [
      { id: 1, name: 'G1' },
      { id: 2, name: 'G2' },
    ];
    const res = await adminAgent.get('/api/admin/users/5/groups');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 1, name: 'G1' },
      { id: 2, name: 'G2' },
    ]);
  });

  it('400 on invalid user id', async () => {
    const res = await adminAgent.get('/api/admin/users/abc/groups');
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Bulk routes
// ---------------------------------------------------------------------------

describe('POST /api/admin/groups/:id/bulk-provision', () => {
  it('200 when all succeed', async () => {
    state.bulkResult = { succeeded: [1, 2], failed: [] };
    const res = await adminAgent
      .post('/api/admin/groups/1/bulk-provision')
      .send({ accountType: 'workspace' });
    expect(res.status).toBe(200);
  });

  it('207 on partial failure', async () => {
    state.bulkResult = {
      succeeded: [1],
      failed: [{ accountId: 2, userId: 2, userName: 'x', error: 'boom' }],
    };
    const res = await adminAgent
      .post('/api/admin/groups/1/bulk-provision')
      .send({ accountType: 'claude' });
    expect(res.status).toBe(207);
  });

  it('400 on missing accountType', async () => {
    const res = await adminAgent
      .post('/api/admin/groups/1/bulk-provision')
      .send({});
    expect(res.status).toBe(400);
  });

  it('400 on invalid accountType', async () => {
    const res = await adminAgent
      .post('/api/admin/groups/1/bulk-provision')
      .send({ accountType: 'github' });
    expect(res.status).toBe(400);
  });

  it('404 when group missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent
      .post('/api/admin/groups/1/bulk-provision')
      .send({ accountType: 'workspace' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/groups/:id/bulk-suspend-all', () => {
  it('200 success', async () => {
    const res = await adminAgent.post('/api/admin/groups/1/bulk-suspend-all');
    expect(res.status).toBe(200);
  });

  it('207 partial', async () => {
    state.bulkResult = {
      succeeded: [1],
      failed: [
        { accountId: 2, userId: 2, userName: 'x', type: 'claude', error: 'e' },
      ],
    };
    const res = await adminAgent.post('/api/admin/groups/1/bulk-suspend-all');
    expect(res.status).toBe(207);
    expect(res.body.failed[0].type).toBe('claude');
  });

  it('404 when missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.post('/api/admin/groups/1/bulk-suspend-all');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/groups/:id/bulk-remove-all', () => {
  it('200 success', async () => {
    const res = await adminAgent.post('/api/admin/groups/1/bulk-remove-all');
    expect(res.status).toBe(200);
  });

  it('404 when missing', async () => {
    state.throwNotFound = true;
    const res = await adminAgent.post('/api/admin/groups/1/bulk-remove-all');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/groups/:id — extended response with permission flags
// ---------------------------------------------------------------------------

describe('GET /api/admin/groups/:id — permission flags', () => {
  it('response includes all three permission flags', async () => {
    const res = await adminAgent.get('/api/admin/groups/42');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 42,
      allowsOauthClient: false,
      allowsLlmProxy: false,
      allowsLeagueAccount: false,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /admin/groups/:id — permission flags (Sprint 026 T005)
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/groups/:id', () => {
  it('200 and calls setPermission for allowsOauthClient', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsOauthClient: true });
    expect(res.status).toBe(200);
    expect(fakeGroups.setPermission).toHaveBeenCalledWith(1, 'oauthClient', true, expect.any(Number));
    expect(res.body).toMatchObject({ id: 1, allowsOauthClient: true });
  });

  it('200 and calls setPermission for allowsLlmProxy', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsLlmProxy: true });
    expect(res.status).toBe(200);
    expect(fakeGroups.setPermission).toHaveBeenCalledWith(1, 'llmProxy', true, expect.any(Number));
    expect(res.body).toMatchObject({ id: 1, allowsLlmProxy: true });
  });

  it('200 and calls setPermission for allowsLeagueAccount', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsLeagueAccount: true });
    expect(res.status).toBe(200);
    expect(fakeGroups.setPermission).toHaveBeenCalledWith(1, 'leagueAccount', true, expect.any(Number));
    expect(res.body).toMatchObject({ id: 1, allowsLeagueAccount: true });
  });

  it('200 and calls setPermission for multiple flags at once', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsOauthClient: true, allowsLlmProxy: false, allowsLeagueAccount: true });
    expect(res.status).toBe(200);
    expect(fakeGroups.setPermission).toHaveBeenCalledTimes(3);
  });

  it('200 with no flags provided — returns current group state', async () => {
    const res = await adminAgent.patch('/api/admin/groups/1').send({});
    expect(res.status).toBe(200);
    expect(fakeGroups.setPermission).not.toHaveBeenCalled();
    expect(fakeGroups.findById).toHaveBeenCalled();
  });

  it('400 when allowsOauthClient is not a boolean', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsOauthClient: 'yes' });
    expect(res.status).toBe(400);
  });

  it('400 when allowsLlmProxy is not a boolean', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsLlmProxy: 1 });
    expect(res.status).toBe(400);
  });

  it('400 when allowsLeagueAccount is not a boolean', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsLeagueAccount: 'true' });
    expect(res.status).toBe(400);
  });

  it('400 on invalid group id', async () => {
    const res = await adminAgent
      .patch('/api/admin/groups/abc')
      .send({ allowsOauthClient: true });
    expect(res.status).toBe(400);
  });

  it('404 when group not found', async () => {
    state.throwNotFound = true;
    const res = await adminAgent
      .patch('/api/admin/groups/1')
      .send({ allowsOauthClient: true });
    expect(res.status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    const res = await request(app)
      .patch('/api/admin/groups/1')
      .send({ allowsOauthClient: true });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Auth boundary
// ---------------------------------------------------------------------------

describe('auth boundary', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).post('/api/admin/groups').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  it('403 non-admin', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'non-admin-groups@example.com',
      displayName: 'Normal User',
      role: 'USER',
    });
    const res = await userAgent.post('/api/admin/groups').send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});
