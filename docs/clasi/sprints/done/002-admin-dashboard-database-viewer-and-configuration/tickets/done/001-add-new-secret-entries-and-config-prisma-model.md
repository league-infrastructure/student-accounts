---
id: '001'
title: Add new secret entries and Config Prisma model
status: done
use-cases:
- SUC-011
depends-on: []
---

# Add new secret entries and Config Prisma model

## Description

Foundation ticket. Add the new secret entries to the example env files and
create the Config Prisma model for runtime credential storage. This must
land first so subsequent tickets can build on the schema and reference the
new environment variables.

## Tasks

1. Add to `secrets/dev.env.example` and `secrets/prod.env.example`:
   - `ADMIN_PASSWORD=change-me`
   - `GITHUB_TOKEN=your-github-token`
   - `GITHUB_STORAGE_REPO=owner/repo-name`
   - `ANTHROPIC_API_KEY=your-anthropic-api-key`
   - `OPENAI_API_KEY=your-openai-api-key`

2. Add Config model to `server/prisma/schema.prisma`:
   ```prisma
   model Config {
     key       String   @id
     value     String
     updatedAt DateTime @updatedAt
   }
   ```

3. Generate and run the Prisma migration.

4. Add placeholder values for the new entries to `.env`.

## Acceptance Criteria

- [ ] `secrets/dev.env.example` contains all 5 new entries with section comments
- [ ] `secrets/prod.env.example` contains all 5 new entries with section comments
- [ ] Config model exists in `schema.prisma` with key (PK), value, updatedAt
- [ ] Migration runs cleanly on a fresh database
- [ ] `npx prisma generate` succeeds

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: None (schema-only; tested implicitly by migration)
- **Verification command**: `cd server && npx prisma migrate dev`
