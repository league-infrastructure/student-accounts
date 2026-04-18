---
id: '003'
title: Default database config to SQLite
status: done
use-cases:
- SUC-001
- SUC-002
depends-on: []
github-issue: ''
todo: sqlite-default-config
---

# Default database config to SQLite

## Description

Change `config/dev/public.env` to default DATABASE_URL to SQLite so students can `npm run dev` without Docker. Include a commented Postgres alternative. Also update `.env.template` if it exists.

## Acceptance Criteria

- [ ] `config/dev/public.env` has `DATABASE_URL=file:./data/dev.db`
- [ ] Commented Postgres alternative included in public.env
- [ ] `.env.template` updated if it exists
- [ ] Config changes committed (not gitignored)

## Testing

- **Verification**: `grep DATABASE_URL config/dev/public.env` shows SQLite default
