import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getContext } from './context';
import fs from 'fs';
import path from 'path';

function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function registerTools(server: McpServer) {
  // get_version — returns the app version from package.json
  server.tool('get_version', 'Get the application version', {}, async () => {
    try {
      const pkgPath = path.resolve(process.cwd(), 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return textResult({ version: pkg.version || '0.1.0' });
    } catch {
      return textResult({ version: '0.1.0' });
    }
  });

  // list_users — returns all users
  server.tool('list_users', 'List all users', {}, async () => {
    const { services } = getContext();
    const users = await services.users.list();
    return textResult(users);
  });
}
