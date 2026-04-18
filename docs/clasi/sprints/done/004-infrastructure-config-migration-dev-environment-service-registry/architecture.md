---
status: draft
---

# Sprint 004 Architecture

## Architecture Overview

This sprint introduces three structural changes to the template's
infrastructure layer. No new user-facing features are added — the goal is
to establish patterns that future sprints build on.

```
┌─────────────────────────────────────────────────┐
│  config/                                        │
│  ├── dev/  (public.env + secrets.env)           │
│  ├── prod/ (public.env + secrets.env)           │
│  └── sops.yaml                                  │
└────────────────────┬────────────────────────────┘
                     │ .env (decrypted, gitignored)
                     ▼
┌─────────────────────────────────────────────────┐
│  docker-compose.dev.yml  (PostgreSQL only)      │
│  port 5433 → 5432                               │
└────────────────────┬────────────────────────────┘
                     │ DATABASE_URL
                     ▼
┌─────────────────────────────────────────────────┐
│  Express Server                                 │
│  ┌───────────────────────────────────────┐      │
│  │  ServiceRegistry (composition root)   │      │
│  │  ├── ConfigService                    │      │
│  │  ├── CounterService                   │      │
│  │  └── LogBufferService                 │      │
│  └───────────────────┬───────────────────┘      │
│                      │                          │
│  Routes ─────────────┘ (thin handlers)          │
└─────────────────────────────────────────────────┘
```

## Technology Stack

No new technologies. This sprint reorganizes existing infrastructure:

- **SOPS + age** — unchanged, now targeting `config/` paths
- **Docker Compose** — new `docker-compose.dev.yml` for dev DB
- **Express + TypeScript** — ServiceRegistry pattern added
- **Prisma 7** — unchanged, injected into ServiceRegistry

## Component Design

### Component: Config Directory

**Purpose**: Organize environment configuration with clear separation of
public and secret values.

**Boundary**: The `config/` directory contains all environment-specific
configuration. Scripts read from it to produce `.env`. The old `secrets/`
directory remains until stakeholder verifies the migration.

**Use Cases**: SUC-001

**Structure**:

```
config/
├── dev/
│   ├── public.env       # Non-secret: APP_DOMAIN, DATABASE_URL, DEPLOYMENT,
│   │                    # PORT, VITE_API_URL, callback URLs, API base URLs
│   └── secrets.env      # SOPS-encrypted: DB_PASSWORD, SESSION_SECRET,
│                        # GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_SECRET,
│                        # PIKE13_CLIENT_SECRET, API keys, tokens
├── prod/
│   ├── public.env       # Production non-secret values
│   └── secrets.env      # Production encrypted secrets
├── local/               # Developer-specific overrides (gitignored)
└── sops.yaml            # Encryption policy (keys + path rules)
```

**Splitting rules**: If a value is useless without the infrastructure it
connects to (a URL, a port, a feature flag), it is public. If a value
grants access or authenticates (a password, token, key, secret), it is
secret.

### Component: Dev Database Compose

**Purpose**: Provide a standalone PostgreSQL instance for local native
development.

**Boundary**: `docker-compose.dev.yml` manages only the database. The
Express server and Vite client run natively on the host.

**Use Cases**: SUC-002

**Configuration**:

```yaml
services:
  db:
    image: postgres:16-alpine
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: devpassword
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

Port 5433 avoids conflicts with any local PostgreSQL on the default 5432.

### Component: ServiceRegistry

**Purpose**: Serve as the single composition root for all service-layer
dependencies.

**Boundary**: Owns all service instances. Created once at app startup.
Routes access it via `req.services`. Tests create isolated registries
with test databases.

**Use Cases**: SUC-003, SUC-004

**Class design**:

```typescript
// server/src/services/service.registry.ts

import type { PrismaClient } from '../../generated/prisma/client';
import type { ServiceSource } from '../contracts/service.js';
import { ConfigService } from './config.js';
import { CounterService } from './counter.js';
import { LogBufferService } from './logBuffer.js';

export class ServiceRegistry {
  public readonly config: ConfigService;
  public readonly counter: CounterService;
  public readonly logBuffer: LogBufferService;

  constructor(
    public readonly prisma: PrismaClient,
    public readonly source: ServiceSource = 'API'
  ) {
    this.config = new ConfigService(prisma);
    this.counter = new CounterService(prisma);
    this.logBuffer = new LogBufferService();
  }

  static async create(
    source?: ServiceSource
  ): Promise<ServiceRegistry> {
    const { prisma, initPrisma } = await import('./prisma.js');
    await initPrisma();
    return new ServiceRegistry(prisma, source);
  }

  async clearAll(): Promise<void> {
    // Truncate service-managed tables for test cleanup
    await this.prisma.$executeRawUnsafe(
      'TRUNCATE "Config", "Counter" CASCADE'
    );
  }
}
```

### Component: Contracts Directory

**Purpose**: Define shared TypeScript types and enums used across services,
routes, and future MCP tools.

**Boundary**: Pure type definitions — no runtime logic, no imports from
service implementations.

**Use Cases**: SUC-003

**Initial files**:

```
server/src/contracts/
├── index.ts       # Re-exports
└── service.ts     # ServiceSource type
```

`service.ts`:
```typescript
export type ServiceSource = 'UI' | 'API' | 'MCP' | 'SYSTEM';
```

Future sprints add `user.ts`, `audit.ts`, `config.ts` as needed.

## Dependency Map

```
Routes
  └── req.services → ServiceRegistry
                       ├── ConfigService → PrismaClient
                       ├── CounterService → PrismaClient
                       └── LogBufferService (in-memory, no Prisma)

ServiceRegistry
  └── PrismaClient → @prisma/adapter-pg → PostgreSQL

contracts/
  └── (no dependencies — pure types)

config/
  └── .env → Express process.env → services
```

## Data Model

No schema changes in this sprint. Existing models (`Config`, `Counter`,
`Session`) are unchanged. The ServiceRegistry wraps access to them through
service classes.

## Security Considerations

- **Secret splitting**: Moving secrets into dedicated encrypted files
  reduces the risk of accidentally committing plaintext secrets. Public
  env files are safe to commit.
- **Config/local/**: Gitignored to prevent developer-specific overrides
  from leaking into the repository.
- **Old secrets/ preserved**: No data loss risk — the old directory stays
  until stakeholder confirms the migration.

## Design Rationale

**Why split public/secret?** A single encrypted file per environment means
developers must decrypt to see any config value, even non-sensitive ones
like `APP_DOMAIN` or `PORT`. Splitting lets public values be read directly
from the repository while keeping actual secrets encrypted.

**Why a separate dev compose file?** Bundling the database with app
services forces a choice: run everything in Docker (slow rebuild cycle) or
manually manage the database. A DB-only compose file lets `npm run dev`
start just the database in Docker while running the server and client
natively for fast iteration.

**Why ServiceRegistry instead of direct imports?** Direct imports create
tight coupling between routes and service implementations. The registry
provides a single injection point that simplifies testing (swap in a test
registry), supports multiple entry points (UI, API, MCP, SYSTEM), and
gives a clear pattern for adding new services.

## Open Questions

- Should `dotconfig init` be run as part of the sprint, or should the
  config directory be created manually? (Depends on whether `dotconfig`
  is already available in the project toolchain.)
- Exact list of variables for `public.env` vs `secrets.env` — to be
  finalized by inspecting the decrypted `secrets/dev.env`.

## Sprint Changes

### Changed Components

**Added:**
- `config/` directory (dev/, prod/, local/, sops.yaml)
- `docker-compose.dev.yml` (PostgreSQL only)
- `server/src/services/service.registry.ts` (ServiceRegistry class)
- `server/src/contracts/` (shared type definitions)
- `server/src/middleware/services.ts` (attaches registry to requests)

**Modified:**
- `server/src/services/config.ts` — refactored from module exports to
  `ConfigService` class
- `server/src/services/counter.ts` — refactored from module exports to
  `CounterService` class
- `server/src/services/logBuffer.ts` — refactored from module exports to
  `LogBufferService` class
- `server/src/index.ts` (or `app.ts`) — creates ServiceRegistry at
  startup, attaches to `app.locals`
- `server/src/routes/counter.ts` — uses `req.services.counter`
- `server/src/routes/admin/*` — uses `req.services.config` and
  `req.services.logBuffer`
- `server/src/routes/health.ts` — uses registry if needed
- `package.json` — updated npm scripts for new dev workflow
- `.gitignore` — add `config/local/`
- `scripts/install.sh` — source from `config/` instead of `secrets/`
- `docs/secrets.md` — updated for config/ layout
- `docs/setup.md` — updated for new dev workflow
- `docs/template-spec.md` — updated repository layout and service layer
  section

**Preserved (not deleted):**
- `secrets/` directory — remains until stakeholder verifies transfer

### Migration Concerns

- The old `secrets/` directory is intentionally preserved. No automated
  migration or deletion occurs. The stakeholder must verify that all
  values are correctly represented in `config/` before `secrets/` is
  removed in a future sprint.
- Existing tests should not need changes beyond updating imports if
  service function signatures change. The ServiceRegistry's `clearAll()`
  method replaces any ad-hoc test cleanup.
- The `docker-compose.yml` (full dev Docker) remains functional alongside
  `docker-compose.dev.yml`. Both can coexist.
