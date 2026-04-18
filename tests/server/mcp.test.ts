import request from 'supertest';
import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';

describe('MCP endpoint — POST /api/mcp', () => {
  const validToken = 'test-mcp-token';

  beforeAll(() => {
    process.env.MCP_DEFAULT_TOKEN = validToken;
  });

  // ---- Auth tests ----

  it('returns 401 without Authorization header', async () => {
    const res = await request(app)
      .post('/api/mcp')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app)
      .post('/api/mcp')
      .set('Authorization', 'Bearer wrong-token')
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('does not return 401 with valid token', async () => {
    const res = await request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ jsonrpc: '2.0', method: 'initialize', id: 1 });
    expect(res.status).not.toBe(401);
  });

  // ---- Bot user creation ----

  it('creates MCP bot user on valid token request', async () => {
    await request(app)
      .post('/api/mcp')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ jsonrpc: '2.0', method: 'initialize', id: 2 });

    const mcpUser = await prisma.user.findFirst({
      where: { primary_email: 'mcp-bot@system.local' },
    });
    expect(mcpUser).not.toBeNull();
    expect(mcpUser!.display_name).toBe('MCP Bot');
    expect(mcpUser!.role).toBe('admin');
    expect(mcpUser!.primary_email).toBe('mcp-bot@system.local');
  });
});
