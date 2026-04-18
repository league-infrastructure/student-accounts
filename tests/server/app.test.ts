import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

// Import the app (not index.ts — avoids starting the server)
import app from '../../server/src/app';

describe('Server smoke tests', () => {
  it('GET /api/health returns 200 with status ok and db ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(res.body).toHaveProperty('appName');
    expect(res.body).toHaveProperty('appSlug');
  });

  it('starts without any OAuth environment variables', async () => {
    // If we got here, the app imported and configured without crashing.
    // Verify it responds to requests.
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
