---
id: '004'
title: Build config service with in-memory cache and env var fallback
status: done
use-cases:
- SUC-006
- SUC-007
- SUC-011
depends-on:
- '001'
---

# Build config service with in-memory cache and env var fallback

## Description

Create the config service that reads credentials from the Config database
table with env var fallback and in-memory caching. This is the backend data
layer that the config panel (ticket #007) and other services will use.

## Tasks

1. Create `server/src/services/config.ts`:

   - Define `CONFIG_KEYS` constant array with metadata:
     ```typescript
     { key: string, group: string, label: string, isSecret: boolean, requiresRestart: boolean }
     ```
     Include all 11 keys from SUC-011 (GitHub OAuth, Google OAuth, Pike 13,
     GitHub API, AI Services).

   - `initConfigCache()` — load all Config rows into an in-memory
     `Map<string, string>` at startup.

   - `getConfig(key)` — returns `process.env[key]` if set, otherwise the
     cached database value, otherwise undefined.

   - `getAllConfig()` — returns all known keys with:
     - `value`: masked if `isSecret` (last 4 chars visible, rest replaced
       with dots)
     - `source`: "environment" | "database" | "not set"
     - `requiresRestart`: boolean
     - `group` and `label` from metadata

   - `setConfig(key, value)` — validates key is in CONFIG_KEYS, upserts
     into Config table (plaintext), refreshes the cache entry.

   - `exportConfig()` — returns all database-stored values (unmasked) as
     `KEY=value\n` string.

2. Call `initConfigCache()` during server startup in `index.ts`.

## Acceptance Criteria

- [ ] `getConfig()` returns env var when both env and DB value exist
- [ ] `getConfig()` returns DB value when no env var is set
- [ ] `getConfig()` returns undefined when neither exists
- [ ] `getAllConfig()` masks secret values (shows last 4 chars)
- [ ] `getAllConfig()` reports correct source for each key
- [ ] `setConfig()` persists to database and updates cache
- [ ] `setConfig()` rejects unknown keys
- [ ] `exportConfig()` returns unmasked KEY=value lines for DB values only
- [ ] Cache is loaded at startup

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/config-service.test.ts`: getConfig precedence, masking,
    setConfig persistence, exportConfig format, unknown key rejection
- **Verification command**: `npm run test:server`
