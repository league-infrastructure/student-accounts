---
title: DATABASE_URL uses shell variable expansion that dotenv doesn't support
priority: high
status: done
sprint: '010'
tickets:
- '005'
---

## Problem

`.env` contains:
```
DATABASE_URL=postgresql://app:devpassword@localhost:${DB_PORT:-5433}/app
```

`dotenv` does not expand shell variable syntax like `${DB_PORT:-5433}`.
The `npm run dev` scripts work around this by sourcing `.env` through
the shell (`set -a && . ./.env && set +a`) before starting the server.
But if the server is started any other way (e.g., directly via
`cd server && npm run dev`), Prisma gets the literal unexpanded string
and fails with "Invalid URL".

## Expected Behavior

Either:
- Replace shell syntax in `.env` with a plain value: `DATABASE_URL=postgresql://app:devpassword@localhost:5433/app`
- Or use `dotenv-expand` package to support variable interpolation
- Or document that the server must always be started via the root `npm run dev`

## Files

- `.env` — DATABASE_URL with shell expansion syntax
- `server/src/index.ts` — loads `.env` via dotenv
- `package.json` — root dev scripts that source `.env` through shell
