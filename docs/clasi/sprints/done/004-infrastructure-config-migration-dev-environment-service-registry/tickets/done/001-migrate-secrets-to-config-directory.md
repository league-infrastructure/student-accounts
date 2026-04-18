---
id: '001'
title: Migrate secrets to config directory
status: todo
use-cases:
- SUC-001
depends-on: []
---

# Migrate secrets to config directory

## Description

Create the `config/` directory structure and migrate existing secrets from
`secrets/` into the new layout. This establishes the split between public
(non-secret) and encrypted (secret) configuration values, organized by
environment.

### Changes

1. **Run `dotconfig init`** to scaffold the `config/` directory structure.
   If `dotconfig` is not available, create the structure manually:
   `config/dev/`, `config/prod/`, `config/local/`.

2. **Split `secrets/dev.env`** into two files:
   - `config/dev/public.env` — non-secret values (APP_DOMAIN, DATABASE_URL,
     DEPLOYMENT, PORT, VITE_API_URL, callback URLs, API base URLs)
   - `config/dev/secrets.env` — SOPS-encrypted secrets (DB_PASSWORD,
     SESSION_SECRET, GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_SECRET,
     PIKE13_CLIENT_SECRET, API keys, tokens)

3. **Split `secrets/prod.env`** into two files:
   - `config/prod/public.env` — production non-secret values
   - `config/prod/secrets.env` — production SOPS-encrypted secrets

4. **Create `config/sops.yaml`** with encryption policy (keys and path
   rules targeting the new `config/` paths).

5. **Update `.sops.yaml`** at the project root to reference the new
   `config/` paths (or replace with a pointer to `config/sops.yaml`).

6. **Update `.gitignore`** to add `config/local/` so developer-specific
   overrides are never committed.

7. **Update `scripts/install.sh`** to source configuration from `config/`
   instead of `secrets/`.

8. **Do NOT delete the old `secrets/` directory.** It remains intact until
   the stakeholder verifies the migration.

## Acceptance Criteria

- [ ] `config/dev/public.env` exists with non-secret environment variables
- [ ] `config/dev/secrets.env` exists and is SOPS-encrypted
- [ ] `config/prod/public.env` exists with production non-secret values
- [ ] `config/prod/secrets.env` exists and is SOPS-encrypted
- [ ] `config/sops.yaml` defines encryption keys and path rules
- [ ] `config/local/` directory exists and is gitignored
- [ ] `.gitignore` updated with `config/local/` entry
- [ ] `scripts/install.sh` updated to read from `config/`
- [ ] Old `secrets/` directory is still present and unmodified
- [ ] Decrypting and combining config files produces a valid `.env`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
  from config path changes
- **Verification**: Decrypt `config/dev/secrets.env`, combine with
  `config/dev/public.env`, confirm all expected variables are present and
  the app starts successfully with the resulting `.env`
