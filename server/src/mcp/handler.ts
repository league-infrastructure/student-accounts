import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server';
import { runWithContext } from './context';
import { ServiceRegistry } from '../services/service.registry';

export function createMcpHandler() {
  return async (req: Request, res: Response) => {
    const user = (req as any).mcpUser;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const services = ServiceRegistry.create('MCP');

    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => {
      transport.close().catch(() => {});
    });

    await runWithContext({ user, services }, async () => {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });
  };
}
