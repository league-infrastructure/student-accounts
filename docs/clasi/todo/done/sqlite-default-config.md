---
title: Default Database Config to SQLite
type: todo
priority: high
status: done
sprint: '016'
tickets:
- '003'
---

# Default Database Config to SQLite

## Problem

The `config/dev/public.env` currently defaults to PostgreSQL:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

Since we've added SQLite support for zero-setup development, the default should be SQLite so students can `npm run dev` without Docker or Postgres.

## What Needs to Happen

1. **Change `config/dev/public.env`** — set `DATABASE_URL=file:./data/dev.db`
2. **Add a commented Postgres alternative** in public.env so students know how to switch:
   ```
   DATABASE_URL=file:./data/dev.db
   # DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
   ```
3. **Ensure the `.env` assembly process** (install script or config tooling) picks up the SQLite default
4. **Check `.env.template`** if one exists — update it too
5. **Verify `config/` gets checked in** — the SQLite default should be committed so new clones get it out of the box
