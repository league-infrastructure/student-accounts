---
status: done
sprint: '002'
tickets:
- 002-009
---

# Deploy current master (OpenRouter proxy) and fix the deployment drift

## Context

Production at `https://student-accounts.jtlapp.net` reports version
`0.20260616.6` and its `/proxy/v1/health` still advertises
`/proxy/v1/messages`: the OpenRouter / League-tiers proxy finished in
sprint 001 (`0.20260627.x`, `package.json` now `0.20260628.1`) has never
been deployed. Everything in the laptop-accounts work builds on the
OpenRouter proxy, so this has to go out first. While doing it, fix the
documentation and config drift found on 2026-10-17 so the next deploy is
boring.

## Scope

- Deploy master to the swarm; verify the proxy end to end with a real
  token.
- Correct the deployment docs and templates.
- Decide and document SQLite-in-prod vs the README's Postgres claim.

## Design / tasks

The deploy itself (step 1) is run by the stakeholder: production serves
real students and this sprint runs unattended. The sprint delivers steps
2-4 and a checked deploy runbook for step 1.

1. **Deploy.** `scripts/deploy.sh prod up` (per `docker-stack.yaml`
   header) after syncing swarm secrets; confirm `OPENROUTER_API_KEY` and
   the three `LLM_PROXY_MODEL_*` values are present in prod config
   (`config/prod/public.env`, secrets). Smoke: `/api/health` shows the new
   version; `/proxy/v1/health` shows `chat/completions`; `/proxy/v1/models`
   returns the three tiers (note: today that path returns the SPA index,
   because the old build has no such route); one authenticated
   `chat/completions` call succeeds and increments `tokens_used`.
2. **Docs drift.** `docker-stack.yaml` header says `apps.jointheleague.org`
   (it serves `student-accounts.jtlapp.net`); `config/prod/secrets.env.example`
   has callback URLs at `student-accounts.jointheleague.org`;
   `server/prisma/schema.prisma` comment on `LlmProxyToken` still says
   "Anthropic Messages API"; `llm-proxy-token.service.ts` header says
   plaintext is never persisted (it is, in `token_plaintext`). Fix each.
3. **Database.** The stack runs SQLite on a manager-pinned volume
   (`DATABASE_URL: file:/app/data/app.db`); README and the schema's
   dual-adapter comment say Postgres in production. Either move to the
   managed Postgres cluster (`league-network/services/postgres`, pattern:
   Class Photos) or state SQLite as the decision and keep the S3 backup
   job as the safety net. Recommend: stay on SQLite for this sprint,
   document it, and raise Postgres as its own issue if the laptop sync's
   write load warrants it.
4. **Inventory.** Update `league-network/sites/README.md` row for
   `student-accounts.jtlapp.net` (repo, stack, that the LLM proxy lives
   here) and add `services/student-accounts/README.md` there, mirroring
   `services/class-photos/README.md`.

## Verification

- `curl -s https://student-accounts.jtlapp.net/api/health` → version ≥
  `0.20260628.1`.
- `curl -s https://student-accounts.jtlapp.net/proxy/v1/models` → JSON with
  `league-large|medium|small`.
- A student's Continue config pointed at `/proxy/v1` with their `llmp_`
  token completes a chat.
- README, stack header and templates agree on domain and database.

## Dependencies

None. Do this first.
