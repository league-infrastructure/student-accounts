import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import app from '../../server/src/app';

describe('Admin Backups API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'backup-admin@example.com',
      displayName: 'Backup Admin',
      role: 'ADMIN',
    });
  }, 30000);

  it('GET /api/admin/export/json returns valid JSON with tables and metadata', async () => {
    const res = await adminAgent.get('/api/admin/export/json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('exportedAt');
    expect(res.body).toHaveProperty('tables');
  });

  it('JSON export includes exportedAt and tables object', async () => {
    const res = await adminAgent.get('/api/admin/export/json');
    expect(res.status).toBe(200);
    expect(typeof res.body.exportedAt).toBe('string');
    expect(typeof res.body.tables).toBe('object');
    // Check expected table keys
    expect(res.body.tables).toHaveProperty('User');
    expect(res.body.tables).toHaveProperty('Config');
    expect(res.body.tables.User).toHaveProperty('count');
    expect(res.body.tables.User).toHaveProperty('records');
  });

  it('returns 403 for non-admin on export', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'backup-user@example.com',
      displayName: 'Backup User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/export/json');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated on export', async () => {
    const res = await request(app).get('/api/admin/export/json');
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin on backup routes', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'backup-user2@example.com',
      displayName: 'Backup User 2',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/backups');
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated on backup routes', async () => {
    const res = await request(app).get('/api/admin/backups');
    expect(res.status).toBe(401);
  });
});
