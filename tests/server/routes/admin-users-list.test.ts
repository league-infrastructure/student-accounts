/**
 * Integration tests for GET /admin/users (Sprint 009 T001).
 *
 * Covers:
 *  - GET /api/admin/users returns externalAccountTypes for users with
 *    external accounts (workspace + pike13)
 *  - GET /api/admin/users returns empty externalAccountTypes for users
 *    with no external accounts
 *  - externalAccountTypes is deduplicated when a user has multiple
 *    accounts of the same type
 *  - Existing fields (id, email, displayName, role, providers, cohort,
 *    createdAt) are present and unchanged
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// GET /api/admin/users
// ===========================================================================

describe('GET /api/admin/users — externalAccountTypes', () => {
  it('includes externalAccountTypes with workspace and pike13 for a user with those accounts', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com');

    const target = await makeUser({ primary_email: 'student@example.com', role: 'student' });
    await makeExternalAccount(target, { type: 'workspace', status: 'active' });
    await makeExternalAccount(target, { type: 'pike13', status: 'active' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.externalAccountTypes).toBeDefined();
    expect(found.externalAccountTypes).toHaveLength(2);
    expect(found.externalAccountTypes).toContain('workspace');
    expect(found.externalAccountTypes).toContain('pike13');
  });

  it('returns empty externalAccountTypes for a user with no external accounts', async () => {
    await makeUser({ primary_email: 'admin2@example.com', role: 'admin' });
    const agent = await loginAs('admin2@example.com');

    const target = await makeUser({ primary_email: 'noaccounts@example.com', role: 'student' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.externalAccountTypes).toEqual([]);
  });

  it('deduplicates externalAccountTypes when a user has multiple accounts of the same type', async () => {
    await makeUser({ primary_email: 'admin3@example.com', role: 'admin' });
    const agent = await loginAs('admin3@example.com');

    const target = await makeUser({ primary_email: 'dup@example.com', role: 'student' });
    await makeExternalAccount(target, { type: 'workspace', status: 'active' });
    await makeExternalAccount(target, { type: 'workspace', status: 'removed' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.externalAccountTypes).toHaveLength(1);
    expect(found.externalAccountTypes).toContain('workspace');
  });

  it('preserves existing fields alongside externalAccountTypes', async () => {
    await makeUser({ primary_email: 'admin4@example.com', role: 'admin' });
    const agent = await loginAs('admin4@example.com');

    const target = await makeUser({ primary_email: 'fields@example.com', role: 'student' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.id).toBeDefined();
    expect(found.email).toBe('fields@example.com');
    expect(found.displayName).toBeDefined();
    expect(found.role).toBeDefined();
    expect(found.providers).toBeDefined();
    expect(found.cohort).toBeDefined();
    expect(found.createdAt).toBeDefined();
    expect(found.externalAccountTypes).toEqual([]);
  });
});
