import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed counter rows for alpha and beta — idempotent via upsert.
  for (const name of ['alpha', 'beta']) {
    await prisma.counter.upsert({
      where: { name },
      update: {},
      create: { name, value: 0 },
    });
  }
  console.log('Seed: counter rows upserted (alpha, beta)');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
