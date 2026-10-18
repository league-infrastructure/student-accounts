# Docker Node Application Template

A Node.js web application template with Express, React, Prisma, and SQLite. Install dependencies, generate the dev `.env`, and start building.

The default home page is a counter demo: two named counters (`alpha` and `beta`) that any logged-in user can increment. Log in with `user` / `pass` (USER role) or `admin` / `admin` (ADMIN role) — no OAuth setup required.

## Getting Started

```bash
# 1. Install dependencies (server and client are separate packages)
( cd server && npm install )
( cd client && npm install )

# 2. Generate the root .env from config/dev/ (decrypts secrets via dotconfig)
scripts/config-load.sh dev > .env

# 3. Start the dev server (runs prisma generate + db push, then server + client)
npm run dev
```

The app starts with SQLite — no Docker, no database setup required. `npm run dev`
(→ `scripts/dev.sh`) sources the root `.env`, so step 2 must run first or Prisma
fails with "datasource.url property is required".

- Frontend: http://localhost:5173
- Backend API: http://localhost:5201/api

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express + TypeScript |
| Frontend | Vite + React + TypeScript |
| Database | SQLite (dev, tests and production; see [Production database](#production-database)) |
| ORM | Prisma 7 |
| AI process | [CLASI](https://github.com/ericbusboom/claude-agent-skills) |

## Development

```bash
npm run dev              # SQLite mode (default, no Docker needed)
npm run deploy:dev       # Full stack in Docker (scripts/up.sh dev)
```

PostgreSQL is supported for local experiments but is not what production
runs (see below). To try it, set `DATABASE_URL` to a `postgresql://` URL in
`config/dev/public.env` and regenerate `.env` (step 2 above). `scripts/dev.sh`
detects the postgres URL and runs `prisma migrate deploy` instead of `db push`:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

## Production database

Production runs **SQLite**, not Postgres. The Swarm stack (`docker-stack.yaml`)
sets `DATABASE_URL=file:/app/data/app.db` on the `app-data` volume and pins the
single replica to a manager node so the volume always lands on the same host.
The safety net is the backup job: the `daily-backup` and `weekly-backup`
scheduled jobs (Admin → Scheduled Jobs) copy the database to DigitalOcean
Spaces (`DO_SPACES_BUCKET`, credentials `DO_SPACES_KEY` / `DO_SPACES_SECRET`).

The Postgres adapter (`@prisma/adapter-pg`) is still wired in
`server/src/services/prisma.ts` and is selected automatically for a
`postgresql://` URL, but no deployment uses it and the Prisma datasource
provider is `sqlite`. Decision 2026-10-18 (sprint 002, ticket 009): stay on
SQLite; if the laptop roster sync's write load ever warrants it, moving to the
managed Postgres cluster is its own issue. Deploy steps and the migration
story are in [docs/deploy.md](docs/deploy.md).

## LLM proxy

The app hosts a small LLM proxy at `/proxy` so students can use AI tools
without holding a provider key of their own. Every request carries the
student's personal token (`llmp_…`), the proxy checks their budget, forwards
the call to [OpenRouter](https://openrouter.ai) with the League's single
`OPENROUTER_API_KEY`, and records what it cost.

**Two protocols, one token.** `GET /proxy` is a self-describing JSON page
that lists both and the environment variables each client needs.

| Protocol | Endpoint | Clients | Setup |
|----------|----------|---------|-------|
| OpenAI Chat Completions | `POST /proxy/v1/chat/completions` (plus `GET /proxy/v1/models`) | OpenAI SDKs, Continue, OpenCode, Hermes, curl, anything with an "OpenAI-compatible base URL" setting | `OPENAI_BASE_URL=<origin>/proxy/v1`, `OPENAI_API_KEY=llmp_…` |
| Anthropic Messages | `POST /proxy/v1/messages` | Claude Code, Anthropic SDKs | `ANTHROPIC_BASE_URL=<origin>/proxy`, `ANTHROPIC_AUTH_TOKEN=llmp_…`, `ANTHROPIC_API_KEY=""` |

Both are passthroughs (the proxy does not translate between protocols;
OpenRouter speaks both). The token goes in `Authorization: Bearer` or
`x-api-key`. The Anthropic surface is behind `LLM_PROXY_ANTHROPIC_ENABLED`
(default `true`); when it is off the route answers 404 and the Claude Code
instructions disappear from the UI. `POST /proxy/v1/messages/count_tokens`
is always 404 because OpenRouter has no token-counting endpoint; Claude Code
tolerates that and estimates locally.

**Tiers, not models.** Clients ask for `league-large`, `league-medium` or
`league-small` and the proxy substitutes the OpenRouter model configured in
`LLM_PROXY_MODEL_LARGE` / `_MEDIUM` / `_SMALL` (defaults
`deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`,
`deepseek/deepseek-v3.2`). Anthropic names are mapped by substring, so Claude
Code's `claude-opus-*` / `claude-sonnet-*` / `claude-haiku-*` land on large /
medium / small without configuration; anything unrecognised is sent as
medium.

**Dollar budgets with a monthly reset.** Each token has a `budget_usd` for
one UTC calendar month (default `LLM_PROXY_DEFAULT_BUDGET_USD`, $5; admins
can set any value up to $1000 per student). The proxy asks OpenRouter for the
cost of every request (`usage: {include: true}`), adds it to the token's
`spent_usd`, and refuses with `429 monthly budget of $5.00 reached; resets
2026-11-01` once the budget is spent. The period rolls over lazily: the first
request in a new UTC month resets `spent_usd` to zero; nothing is scheduled.
If OpenRouter ever omits the cost, a per-tier price table
(`LLM_PROXY_PRICE_LARGE` / `_MEDIUM` / `_SMALL`, "USD per 1M input,USD per
1M output") estimates it so accounting never records zero. `spent_usd_total`
keeps the lifetime figure. Tokens from before sprint 003 have no budget and
keep the old lifetime token quota until an admin sets one or runs
`POST /api/admin/llm-proxy/backfill-budgets` (see
[docs/deploy.md](docs/deploy.md), section 7b).

**Request log.** Every proxied call writes one `LlmProxyRequest` row:
timestamp, protocol, model requested and model actually sent, input/output
tokens, `cost_usd` and HTTP status. The daily `llm-proxy-request-prune` job
deletes rows older than **90 days**; the running totals on the token survive
the prune.

**Where people see it.**

- *Students*: the Account page has a compact LLM Proxy card (`$spent of
  $limit`, reset date, masked key with copy) and a "Set up and details"
  button to `/llm-proxy`, a full page with copy-paste setup for Claude Code,
  curl, Continue, OpenCode, Hermes, Python and a generic env block, each
  already containing their token and the endpoint. API:
  `GET /api/account/llm-proxy`.
- *Admins*: Admin → User Management → a user shows an LLM Proxy card with the
  dollar meter, an editable monthly limit (audited as
  `llm_proxy_budget_changed`), the key with reveal/copy, an OpenRouter
  activity link and "Open LLM page" to `/admin/users/:id/llm-proxy`, which
  renders the same setup examples with that student's token plus a
  recent-requests table. API: `GET /api/admin/users/:id/llm-proxy`,
  `GET /api/admin/users/:id/llm-proxy/requests`,
  `PATCH /api/admin/llm-proxy/tokens/:id {budgetUsd}`.
- *Laptops*: `POST /api/fleet/llm-token` (username + password) returns the
  token, both base URLs and the same dollar figures, so `league-helper login`
  can configure the student's tools.

Config keys and their defaults are documented in `config/dev/public.env`;
the server code is `server/src/routes/llm-proxy.ts`,
`server/src/services/llm-proxy-forwarder.service.ts`,
`server/src/services/llm-proxy-token.service.ts` and
`server/src/services/llm-proxy-pricing.ts`.

## Testing

```bash
npm run test:server   # Backend API (Vitest)
npm run test:client   # Frontend components (Vitest)
```

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/testing.md](docs/testing.md) | Test strategy and guidelines |
| [docs/oauth-provider.md](docs/oauth-provider.md) | OAuth 2.0 provider — integrator guide |
| `.claude/rules/setup.md` | Detailed setup and troubleshooting |
| [docs/deploy.md](docs/deploy.md) | Production deploy runbook (Docker Swarm, SQLite, smoke checks, rollback) |
| `.claude/rules/template-spec.md` | Architecture and conventions |
