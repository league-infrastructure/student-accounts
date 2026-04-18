---
id: 009
title: Health-check endpoint + CI skeleton (lint, type-check, test on push)
status: done
use-cases:
- SUC-005
depends-on:
- 008
github-issue: ''
todo: ''
---

# Health-check endpoint + CI skeleton (lint, type-check, test on push)

## Description

Enhance the health-check endpoint to verify database connectivity, then add
a GitHub Actions CI workflow that runs lint, TypeScript type-check, and the
test suite on every push to `master` and on every pull request.

This is the last ticket in the sprint — it runs after the full service layer
is in place (T008) and serves as the integration gate that confirms the
complete sprint deliverable works end-to-end.

## Acceptance Criteria

- [x] `GET /api/health` returns `200 { status: "ok", db: "ok" }` when the
      database is reachable.
- [x] `GET /api/health` returns `503 { status: "error", db: "unreachable" }`
      (or similar) when the database ping fails. The server must not crash.
- [x] The health endpoint pings the database with a lightweight query
      (e.g., `prisma.$queryRaw\`SELECT 1\``).
- [x] A GitHub Actions workflow file exists at `.github/workflows/ci.yml`.
- [x] The CI workflow runs on: `push` to `master`, `pull_request` targeting
      `master`.
- [x] The CI workflow has three sequential jobs (or steps within one job):
      1. **lint** — runs ESLint (or the project's configured linter). If no
         linter is yet configured, add a minimal ESLint setup for TypeScript
         (eslint + @typescript-eslint/parser + @typescript-eslint/eslint-plugin)
         and a `.eslintrc.json`. A zero-warnings run must pass.
      2. **type-check** — runs `cd server && npx tsc --noEmit`. Must pass
         with zero errors.
      3. **test** — runs `npm run test:server` against the SQLite test DB
         (no external services required). Must pass with all tests green.
- [x] The CI workflow uses `ubuntu-latest`, `node: 20`.
- [x] The `npm run test:server` and `npm run build` scripts continue to work
      locally (no CI-only environment assumptions introduced).
- [x] Integration test `tests/server/app.test.ts` (or a new
      `tests/server/health.test.ts`) covers:
      - `GET /api/health` returns 200 with `{ status: "ok" }` when the
        SQLite test database is up and migrations are applied.

## Implementation Plan

### Health Endpoint

Update `server/src/routes/health.ts`:

```typescript
router.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});
```

The route already exists from the template; update it to add the DB ping.

### Linting Setup (if not yet present)

If ESLint is not configured in the server package:

1. Add to `server/package.json` devDependencies:
   `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
2. Create `server/.eslintrc.json` with minimal TypeScript rules.
3. Add `"lint": "eslint src --ext .ts"` to `server/package.json` scripts.
4. Run `npm run lint` from `server/` and fix any warnings or errors.

### CI Workflow

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [master]
  pull_request:
    branches: [master]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: server/package-lock.json
      - run: cd server && npm ci
      - name: Lint
        run: cd server && npm run lint
      - name: Type-check
        run: cd server && npx tsc --noEmit
      - name: Apply migrations (SQLite test DB)
        run: cd server && DATABASE_URL=file:./data/test.db npx prisma migrate deploy
      - name: Test
        run: npm run test:server
        env:
          DATABASE_URL: file:./server/data/test.db
```

Adjust paths as needed to match the actual working directory assumptions in
`vitest.config.ts` and `global-setup.ts`.

### Files to Create

- `.github/workflows/ci.yml`
- `server/.eslintrc.json` (if linter not yet configured)

### Files to Modify

- `server/src/routes/health.ts` — add DB ping.
- `server/package.json` — add lint script if not present; add ESLint
  devDependencies if not present.
- `tests/server/app.test.ts` — add or update health endpoint assertion.

### Testing Plan

- Run `GET /api/health` locally with SQLite — expect 200.
- Verify the CI workflow syntax is valid by pushing a branch and checking
  the Actions tab on GitHub (or use `act` locally if available).
- `npm run test:server` passes with the health test included.

### Documentation Updates

None beyond the CI workflow file itself.
