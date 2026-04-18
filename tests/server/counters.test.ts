import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';

/** Helper: log in as a USER and return an authenticated supertest agent. */
async function loginAsUser(email = 'countertest@example.com') {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email,
    displayName: 'Counter Test User',
    role: 'USER',
  });
  return agent;
}

beforeEach(async () => {
  // Remove test counters so each test starts clean.
  try {
    await (prisma as any).counter.deleteMany({
      where: { name: { in: ['alpha', 'beta', 'gamma', 'unknown-new'] } },
    });
  } catch {
    // Table may not exist if migrations haven't run yet — tolerate.
  }
});

afterAll(async () => {
  try {
    await (prisma as any).counter.deleteMany({
      where: { name: { in: ['alpha', 'beta', 'gamma', 'unknown-new'] } },
    });
  } catch {
    // Ignore
  }
});

describe('GET /api/counters', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/counters');
    expect(res.status).toBe(401);
  });

  it('returns an array when authenticated', async () => {
    const agent = await loginAsUser();
    const res = await agent.get('/api/counters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('includes seeded alpha and beta counters', async () => {
    // Seed two counters directly.
    await (prisma as any).counter.createMany({
      data: [
        { name: 'alpha', value: 0 },
        { name: 'beta', value: 0 },
      ],
    });

    const agent = await loginAsUser();
    const res = await agent.get('/api/counters');
    expect(res.status).toBe(200);

    const names = res.body.map((c: any) => c.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });
});

describe('POST /api/counters/:name/increment', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/counters/alpha/increment');
    expect(res.status).toBe(401);
  });

  it('increments an existing counter by 1', async () => {
    await (prisma as any).counter.create({ data: { name: 'alpha', value: 5 } });

    const agent = await loginAsUser();
    const res = await agent.post('/api/counters/alpha/increment');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'alpha', value: 6 });
  });

  it('auto-creates a new counter with value = 1', async () => {
    const agent = await loginAsUser();
    const res = await agent.post('/api/counters/gamma/increment');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'gamma', value: 1 });
  });

  it('returns the updated value in subsequent increments', async () => {
    const agent = await loginAsUser();

    const first = await agent.post('/api/counters/beta/increment');
    expect(first.status).toBe(200);
    expect(first.body.value).toBe(1);

    const second = await agent.post('/api/counters/beta/increment');
    expect(second.status).toBe(200);
    expect(second.body.value).toBe(2);
  });
});
