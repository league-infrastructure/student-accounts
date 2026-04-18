import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './tools';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'college-app-navigator',
    version: '0.1.0',
  });

  registerTools(server);

  return server;
}
