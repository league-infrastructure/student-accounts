---
status: final
---

# Architecture — Sprint 016

## Architecture Overview

No architectural changes. This sprint modifies scripts, configuration defaults, and documentation only. The application code is unchanged.

## Sprint Changes

### Changed Components

**Modified:**
- `scripts/install.sh` — remove SOPS/age sections, add CLASI reset step, simplify .env generation
- `config/dev/public.env` — default DATABASE_URL to SQLite
- `README.md` — rewrite for student getting-started experience
- `package.json` — remove `secrets:add-key` script entry

**Removed:**
- `scripts/add-age-key.sh` — obsolete (encryption managed by dotconfig)
- `scripts/encrypt-secrets.sh` — obsolete
- `scripts/load-secrets.sh` — obsolete (if confirmed unused)

### Migration Concerns

None. These changes affect development tooling only.
