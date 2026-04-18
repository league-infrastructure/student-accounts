import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.ADMIN_PASSWORD = 'test-admin-pass';

import app from '../../server/src/app';

describe('Admin Authentication', () => {
  describe('POST /api/admin/login', () => {
    it('returns 200 with correct password', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: 'test-admin-pass' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 401 with incorrect password', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid password');
    });

    it('returns 400 when password is missing', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 503 when ADMIN_PASSWORD is not set', async () => {
      const saved = process.env.ADMIN_PASSWORD;
      delete process.env.ADMIN_PASSWORD;

      const res = await request(app)
        .post('/api/admin/login')
        .send({ password: 'anything' });
      expect(res.status).toBe(503);

      process.env.ADMIN_PASSWORD = saved;
    });
  });

  describe('GET /api/admin/check', () => {
    it('returns authenticated: false without login', async () => {
      const res = await request(app).get('/api/admin/check');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('requireAdmin middleware', () => {
    it('blocks unauthenticated access to admin endpoints', async () => {
      const res = await request(app).get('/api/admin/env');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Unauthorized');
    });
  });

  describe('POST /api/admin/logout', () => {
    it('returns 200', async () => {
      const res = await request(app)
        .post('/api/admin/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
