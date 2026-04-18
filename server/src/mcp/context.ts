import { AsyncLocalStorage } from 'async_hooks';
import type { ServiceRegistry } from '../services/service.registry';

export interface McpContext {
  user: { id: number; email: string; displayName: string; role: string };
  services: ServiceRegistry;
}

const asyncLocalStorage = new AsyncLocalStorage<McpContext>();

export function runWithContext<T>(ctx: McpContext, fn: () => T): T {
  return asyncLocalStorage.run(ctx, fn);
}

export function getContext(): McpContext {
  const ctx = asyncLocalStorage.getStore();
  if (!ctx) {
    throw new Error('MCP context not available — called outside runWithContext');
  }
  return ctx;
}
