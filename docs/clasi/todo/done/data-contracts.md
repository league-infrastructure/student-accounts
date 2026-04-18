---
status: pending
priority: medium
source: inventory app (server/src/contracts/)
---

# Data Contract Types

Decouple the API layer from the database schema by defining contract
types that services accept and return. Routes and clients work with
contracts, not raw Prisma types.

## Why

Prisma-generated types include every field, relation, and internal detail.
Exposing them directly through the API means:

- Schema changes break clients
- Internal fields (hashed passwords, internal IDs) leak to the frontend
- No clear documentation of what the API actually returns
- Tests couple to Prisma types instead of the API surface

Contract types define the API boundary explicitly.

## Structure

Create `server/src/contracts/` with one file per domain:

### user.ts

```typescript
export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

export interface UserRecord {
  id: number;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  createdAt: string; // ISO date
}

export interface CreateUserInput {
  email: string;
  displayName?: string;
  role?: UserRole;
}

export interface UpdateUserInput {
  displayName?: string;
  role?: UserRole;
  avatarUrl?: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.USER]: 'User',
  [UserRole.ADMIN]: 'Administrator',
};

export function hasAdminAccess(role: UserRole): boolean {
  return role === UserRole.ADMIN;
}
```

### audit.ts

```typescript
export type AuditSource = 'UI' | 'IMPORT' | 'API' | 'MCP' | 'SYSTEM';

export interface AuditEntry {
  userId: number | null;
  objectType: string;
  objectId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  source: AuditSource;
}
```

### index.ts

Barrel export for all contracts:

```typescript
export * from './user';
export * from './audit';
```

## Conversion Pattern

Services convert Prisma types to contract types before returning:

```typescript
function toUserRecord(prismaUser: PrismaUser): UserRecord {
  return {
    id: prismaUser.id,
    email: prismaUser.email,
    displayName: prismaUser.displayName,
    avatarUrl: prismaUser.avatarUrl,
    role: prismaUser.role as UserRole,
    createdAt: prismaUser.createdAt.toISOString(),
  };
}
```

## Client Sharing

Contract types can be shared with the React client. Place shared types
in `server/src/contracts/` and have the client import them, or duplicate
them in `client/src/types/`. The inventory app keeps them in the server
and the client references them via path alias.

## Reference Files

- Inventory: `server/src/contracts/user.ts`, `site.ts`, `kit.ts`,
  `computer.ts`, `pack.ts`, `transfer.ts`, `index.ts`

## Verification

- Services return contract types, not Prisma types
- API responses match contract type shapes
- Internal fields (provider IDs, hashed tokens) are not exposed
- Client code uses contract types for type safety
