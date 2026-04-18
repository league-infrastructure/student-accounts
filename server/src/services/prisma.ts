// Lazy-initialized Prisma client.
// Selects the adapter based on DATABASE_URL:
//   - "file:" prefix → @prisma/adapter-better-sqlite3 (dev / integration tests)
//   - anything else  → @prisma/adapter-pg (production PostgreSQL)
//
// NOTE: Prisma 7 enforces strict adapter/provider matching. While the schema
// currently uses provider = "sqlite" (required for SQLite adapter compatibility
// in dev/test), the Postgres branch is wired and ready. It will activate
// correctly once the schema migrates to provider = "postgresql" in the ticket
// that replaces the template data model with the domain schema.
let _prisma: any;

async function getPrismaClient() {
  if (!_prisma) {
    const { PrismaClient } = await import('../generated/prisma/client');
    const databaseUrl = process.env.DATABASE_URL ?? '';
    if (databaseUrl.startsWith('file:')) {
      const { PrismaBetterSqlite3 } = await import('@prisma/adapter-better-sqlite3');
      const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
      _prisma = new PrismaClient({ adapter });
    } else {
      const { PrismaPg } = await import('@prisma/adapter-pg');
      const adapter = new PrismaPg({ connectionString: databaseUrl });
      _prisma = new PrismaClient({ adapter });
    }
  }
  return _prisma;
}

// Proxy that forwards all property access to the lazily-initialized client.
// This lets consuming code use `prisma.model.method()` synchronously after
// the app has started (the server init awaits getPrismaClient first).
export const prisma = new Proxy({} as any, {
  get(_target, prop) {
    if (!_prisma) {
      throw new Error(
        'Prisma client not initialized. Call initPrisma() before using the client.'
      );
    }
    return (_prisma as any)[prop];
  },
});

export async function initPrisma() {
  await getPrismaClient();
}
