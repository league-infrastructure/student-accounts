import dotenv from 'dotenv';
import path from 'path';
import { defineConfig } from 'prisma/config';

// Load .env from project root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrate: {
    url: process.env.DATABASE_URL!,
  },
});
