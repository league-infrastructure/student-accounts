import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma';

export async function mcpTokenAuth(req: Request, res: Response, next: NextFunction) {
  const token = process.env.MCP_DEFAULT_TOKEN;
  if (!token) {
    res.status(503).json({ error: 'MCP not configured — MCP_DEFAULT_TOKEN not set' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const bearerToken = authHeader.slice(7);
  if (bearerToken !== token) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  // Upsert the MCP bot user
  const mcpUser = await prisma.user.upsert({
    where: { provider_providerId: { provider: 'mcp', providerId: 'mcp-bot' } },
    update: {},
    create: {
      provider: 'mcp',
      providerId: 'mcp-bot',
      email: 'mcp-bot@system.local',
      displayName: 'MCP Bot',
      role: 'ADMIN',
    },
  });

  (req as any).mcpUser = mcpUser;
  next();
}
