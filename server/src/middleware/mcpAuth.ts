import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma.js';

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

  // Upsert the MCP bot user using the domain schema.
  const mcpUser = await prisma.user.upsert({
    where: { primary_email: 'mcp-bot@system.local' },
    update: {},
    create: {
      primary_email: 'mcp-bot@system.local',
      display_name: 'MCP Bot',
      role: 'admin',
      created_via: 'admin_created',
    },
  });

  (req as any).mcpUser = mcpUser;
  next();
}
