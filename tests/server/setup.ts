// Vitest global setup — runs before all test files
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'file:./data/test.db';

// Initialize Prisma client so routes that use it (test-login, admin CRUD) work
import { initPrisma } from '../../server/src/services/prisma';
await initPrisma();

// Database cleanup is handled by global-setup.ts (runs once before/after all files).
