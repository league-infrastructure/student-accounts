---
id: '010'
title: Set up server test infrastructure (Jest + Supertest)
status: done
use-cases: []
depends-on:
- '002'
---

# Set up server test infrastructure (Jest + Supertest)

## Description

The `tests/` directory structure doesn't exist yet. Set up the server
test layer so all subsequent tickets can include backend tests.

## Changes

1. **Install test dependencies** in `server/package.json`:
   - `jest`, `ts-jest`, `@types/jest` (dev)
   - `supertest`, `@types/supertest` (dev)

2. **Create `tests/server/jest.config.js`**:
   - Use `ts-jest` preset
   - Root dir pointing at the server source
   - Test match: `tests/server/**/*.test.ts`

3. **Create `tests/server/app.test.ts`** — smoke tests:
   - Server exports the Express app (already does via `export default app`)
   - `GET /api/health` returns 200 `{ status: 'ok' }`
   - `GET /api/counter` returns 200 with counter data
   - Server does not crash with zero integration env vars

4. **Refactor `server/src/index.ts`** if needed:
   - Ensure the app is exported without calling `app.listen()` at import
     time (Supertest needs the app object, not a running server). This
     may require splitting app creation from server start.

5. **Create directory structure**:
   ```
   tests/
   ├── server/
   │   ├── jest.config.js
   │   └── app.test.ts
   ├── db/        (empty, for future)
   ├── client/    (empty, for future)
   └── e2e/       (empty, for future)
   ```

## Acceptance Criteria

- [ ] `npm run test:server` runs and passes
- [ ] Smoke test verifies `/api/health` returns 200
- [ ] Smoke test verifies server starts with no OAuth env vars
- [ ] Test directory structure created for all 4 layers

## Testing

- **Verification command**: `npm run test:server`
