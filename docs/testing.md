# Testing Strategy

> This document defines the testing approach for this project. All agents
> writing or modifying tests MUST follow these conventions.

---

## 1. Test Layers

| Layer | Directory | Framework | Database? | Purpose |
|-------|-----------|-----------|-----------|---------|
| **Server** | `tests/server/` | Jest + Supertest | Yes (test DB) | API routes, middleware, services — real HTTP requests against Express |
| **Database** | `tests/db/` | Jest + Prisma | Yes (test DB) | Migrations, constraints, raw queries, JSONB, triggers |
| **Client** | `tests/client/` | Vitest + RTL | No | Component rendering, hooks, state logic |
| **E2E** | `tests/e2e/` | Playwright | Yes (dev DB) | Full user flows through a real browser |

```bash
npm test              # Shows available suites
npm run test:db       # Database layer
npm run test:server   # Backend API layer
npm run test:client   # Frontend components
npm run test:e2e      # End-to-end browser tests
```

---

## 2. Test Authentication Bypass

OAuth flows (GitHub, Google) cannot be exercised in automated tests.
The server exposes a **test-only login endpoint** that injects a fake
authenticated user into the session, bypassing the OAuth redirect flow.

### 2.1 The Endpoint

```
POST /api/auth/test-login
```

- **Available only when** `NODE_ENV === 'test'` (or a `ENABLE_TEST_AUTH`
  env var is set). The route MUST NOT be registered in production.
- **Request body:**
  ```json
  {
    "provider": "github",
    "id": "test-user-1",
    "displayName": "Test User",
    "email": "test@example.com",
    "role": "student"
  }
  ```
- **Behaviour:** Calls `req.login(user, ...)` to establish a Passport
  session identical to what a real OAuth callback would produce.
- **Response:** `200 { success: true, user: { ... } }`

### 2.2 Why This Exists

Server tests need to exercise authenticated API routes (profile CRUD,
academic plans, chat, admin endpoints) without spinning up a real OAuth
provider. By logging in through this endpoint first, subsequent Supertest
requests carry a valid session cookie.

### 2.3 Using It in Tests

```typescript
import request from 'supertest';
process.env.NODE_ENV = 'test';
import app from '../../server/src/app';

describe('authenticated API', () => {
  let agent: request.SuperAgentTest;

  beforeAll(async () => {
    agent = request.agent(app);          // maintains cookies across requests
    await agent
      .post('/api/auth/test-login')
      .send({
        provider: 'github',
        id: 'test-user-1',
        displayName: 'Test User',
        email: 'test@example.com',
      })
      .expect(200);
  });

  it('returns the current user', async () => {
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('Test User');
  });
});
```

Key detail: use `request.agent(app)` (not `request(app)`) so the session
cookie persists across requests within a test suite.

### 2.4 Admin Test Login

For admin-protected routes, tests should use the existing admin login:

```typescript
await agent
  .post('/api/admin/login')
  .send({ password: process.env.ADMIN_PASSWORD })
  .expect(200);
```

Set `ADMIN_PASSWORD` in the test environment before importing the app.

---

## 3. Server Tests (`tests/server/`)

### 3.1 What to Test

- **Every API route** gets at least one happy-path test and one
  error/validation test.
- Tests make real HTTP requests via Supertest against the Express app.
- Tests that modify the database MUST use a test database (see §6) and
  clean up after themselves.
- Test both authenticated and unauthenticated access for protected routes.

### 3.2 Patterns

```typescript
import request from 'supertest';
process.env.NODE_ENV = 'test';
import app from '../../server/src/app';

describe('GET /api/some-resource', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/some-resource');
    expect(res.status).toBe(401);
  });

  it('returns data when authenticated', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({ ... }).expect(200);

    const res = await agent.get('/api/some-resource');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});
```

### 3.3 Form Data vs JSON

- JSON APIs: `.send({ key: 'value' })` — Supertest sets Content-Type
  automatically.
- Form-encoded: `.send('key=value').type('form')` — for any endpoint
  expecting `application/x-www-form-urlencoded`.
- File uploads: use `.attach('file', buffer, 'filename.txt')`.

### 3.4 Database Assertions

When a route modifies the database, assert the change:

```typescript
it('creates a new record', async () => {
  await agent.post('/api/items').send({ name: 'Test' }).expect(201);

  // Verify the database was actually modified
  const item = await prisma.item.findFirst({ where: { name: 'Test' } });
  expect(item).not.toBeNull();
});
```

---

## 4. Database Tests (`tests/db/`)

- Test Prisma migrations apply cleanly.
- Test constraints (unique, foreign key, check) by attempting violations.
- Test JSONB queries, indexes, and raw SQL when used.
- Run against the test database with migrations applied in a
  `globalSetup` script.

---

## 5. Client Tests (`tests/client/`)

- Use **Vitest** + **React Testing Library**.
- Test component rendering, user interactions, and state changes.
- Mock API calls — do not hit the real server.
- Located in `tests/client/`, not co-located with source files.

---

## 6. E2E Tests (`tests/e2e/`)

### 6.1 Framework

**Playwright** drives a real browser against the running application.

### 6.2 Setup

E2E tests require the full stack running (server + client + database).
Use `npm run dev` or `npm run dev:docker` before running E2E tests.

### 6.3 Authentication in E2E

E2E tests use the same test-login endpoint (§2) via Playwright's
`request` API to establish a session, then inject the cookie into the
browser context:

```typescript
const context = await browser.newContext();
const apiContext = context.request;
await apiContext.post('/api/auth/test-login', {
  data: { provider: 'github', id: 'e2e-user', displayName: 'E2E User' }
});
// Session cookie is now set — page navigations will be authenticated
const page = await context.newPage();
await page.goto('/dashboard');
```

### 6.4 What to Test

- Critical user flows: sign up, onboarding, questionnaire completion,
  plan generation.
- Navigation and routing.
- Form submissions that hit the API and display results.
- Error states visible in the UI.

---

## 6.5 MCP Server Testing

The MCP server (`POST /api/mcp`) can be tested via Supertest like any
other API endpoint. Set the `MCP_DEFAULT_TOKEN` environment variable
and send requests with the `Authorization: Bearer <token>` header:

```typescript
const res = await request(app)
  .post('/api/mcp')
  .set('Authorization', `Bearer ${process.env.MCP_DEFAULT_TOKEN}`)
  .send({ /* MCP request body */ });
```

MCP tools use the same `ServiceRegistry` as the web UI, so service-level
logic is testable independently of the MCP transport layer.

---

## 7. Test Database

### 7.1 Configuration

Tests that require a database use a separate test database. The
connection string is set via `DATABASE_URL` in the test environment.

The dev `docker-compose.yml` already provides a Postgres instance.
Tests can use either:
- The same Postgres instance with a different database name
  (e.g., `appname_test`)
- A dedicated test container

### 7.2 Lifecycle

1. **Before suite:** Run `prisma migrate deploy` against the test DB.
2. **Between tests:** Truncate tables or wrap each test in a transaction
   that rolls back.
3. **After suite:** Drop the test database (optional; leaving it speeds
   up re-runs).

### 7.3 Prisma in Tests

Import the Prisma client from the service module. Since tests run in
CJS mode via ts-jest, and the Prisma client is ESM, the lazy-init
pattern in `server/src/services/prisma.ts` handles this. Call
`initPrisma()` in a `beforeAll` block when tests need database access:

```typescript
import { prisma, initPrisma } from '../../server/src/services/prisma';

beforeAll(async () => {
  await initPrisma();
});

afterAll(async () => {
  await prisma.$disconnect();
});
```

---

## 8. Agent Guidelines

### 8.1 When Writing Tests

- Follow the layer structure — put server tests in `tests/server/`, not
  in `server/src/`.
- Every new API route MUST have corresponding tests.
- Use the test-login endpoint for authenticated route tests — never mock
  the session middleware directly.
- Assert both the HTTP response AND the database state when applicable.
- Use descriptive test names: `it('returns 403 when non-admin accesses
  admin route')` not `it('works')`.

### 8.2 When Implementing Features

- Run `npm run test:server` after any backend change.
- Run `npm run test:client` after any frontend change.
- Run `npm run test:e2e` before marking a ticket as done (if E2E tests
  exist for that feature).
- All tests must pass before a ticket can be marked done.

### 8.3 Test File Naming

- Server: `tests/server/<feature>.test.ts`
- Database: `tests/db/<feature>.test.ts`
- Client: `tests/client/<Component>.test.tsx`
- E2E: `tests/e2e/<flow>.spec.ts`
