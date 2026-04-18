/**
 * Vitest globalSetup — runs exactly once before all test files start
 * and once after all test files finish.
 * Used for database cleanup so test data doesn't accumulate across runs.
 */

const connectionString = process.env.DATABASE_URL || 'file:./data/test.db';

async function cleanup() {
  const Database = (await import('better-sqlite3')).default;
  const dbPath = connectionString.replace('file:', '');
  let db;
  try {
    db = new Database(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name).filter((n) => n !== '_prisma_migrations' && n !== 'sqlite_sequence');
    for (const table of tableNames) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }
  } catch {
    // DB file may not exist yet
  } finally {
    db?.close();
  }
}

export async function setup() {
  await cleanup();
}

export async function teardown() {
  await cleanup();
}
