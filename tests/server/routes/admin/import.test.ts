/**
 * Integration tests for POST /api/admin/import/laptop-roster (sprint 002 T003).
 *
 * Covers:
 *  - 401 when not authenticated
 *  - 403 for a student session
 *  - 200 with the ImportReport shape for an admin; default group "Botball 26"
 *  - body.groupName is honoured
 *  - 400 when groupName is not a string
 *  - 503 with a clear message when the roster client is not configured
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { GroupService } from '../../../../server/src/services/group.service.js';
import { LaptopRosterImportService } from '../../../../server/src/services/laptop/laptop-roster-import.service.js';
import { UnconfiguredLaptopRosterClient } from '../../../../server/src/services/laptop/laptop-roster.client.js';
import { FakeLaptopRosterClient } from '../../helpers/fake-laptop-roster.client.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

function installService(roster: FakeLaptopRosterClient | UnconfiguredLaptopRosterClient): void {
  const audit = new AuditService();
  (registry as any).laptopRosterImport = new LaptopRosterImportService(
    roster,
    prisma as any,
    new GroupService(prisma as any, audit),
    audit,
    async () => {},
  );
}

const originalService = (registry as any).laptopRosterImport;

beforeEach(async () => {
  await cleanDb();
});

afterAll(() => {
  (registry as any).laptopRosterImport = originalService;
});

describe('POST /api/admin/import/laptop-roster — auth enforcement', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/admin/import/laptop-roster').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a student session', async () => {
    installService(new FakeLaptopRosterClient());
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.post('/api/admin/import/laptop-roster').send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/import/laptop-roster — admin', () => {
  it('returns 200 with the ImportReport shape and defaults the group to "Botball 26"', async () => {
    const roster = new FakeLaptopRosterClient().seed({
      id: 'zoe',
      display_name: 'Zoe',
      password_hash: HASH,
      created: '20260825T170542Z',
      created_host: 'jtl-inspiron-1',
    });
    installService(roster);

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/import/laptop-roster').send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, matched: 0, skipped: 0, errors: 0 });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details[0]).toMatchObject({ id: 'zoe', outcome: 'created' });

    const group = await (prisma as any).group.findUnique({ where: { name: 'Botball 26' } });
    expect(group).toBeTruthy();

    const summary = await (prisma as any).auditEvent.findFirst({
      where: { action: 'laptop_roster_imported' },
    });
    expect(summary).toBeTruthy();
    expect(summary.details).toMatchObject({ created: 1, matched: 0, skipped: 0, errors: 0 });
    const admin = await (prisma as any).user.findUnique({ where: { primary_email: 'admin@example.com' } });
    expect(summary.actor_user_id).toBe(admin.id);
  });

  it('honours body.groupName', async () => {
    installService(new FakeLaptopRosterClient());
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent
      .post('/api/admin/import/laptop-roster')
      .send({ groupName: 'Botball 27' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 0, matched: 0, skipped: 0, errors: 0, details: [] });
    expect(await (prisma as any).group.findUnique({ where: { name: 'Botball 27' } })).toBeTruthy();
  });

  it('returns 400 when groupName is not a string', async () => {
    installService(new FakeLaptopRosterClient());
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/import/laptop-roster').send({ groupName: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/groupName/);
  });

  it('returns 503 with a clear message when the roster is not configured', async () => {
    installService(new UnconfiguredLaptopRosterClient());
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/import/laptop-roster').send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body.error).toMatch(/DO_SPACES_KEY/);
  });
});
