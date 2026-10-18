---
id: 009
title: Deployment docs drift and deploy runbook
status: done
use-cases:
- SUC-008
depends-on: []
github-issue: ''
issue: deploy-current-master-and-fix-deployment-docs.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Deployment docs drift and deploy runbook

## Description

Documentation only. Fix the deployment drift found in the 2026-10-17 review and write the runbook the stakeholder will follow to deploy master (production still runs the June build with the old Anthropic proxy). No code changes.

## Acceptance Criteria

- [x] `docker-stack.yaml` header: says `student-accounts.jtlapp.net`, not `apps.jointheleague.org`.
- [x] `config/prod/secrets.env.example`: callback URLs use `student-accounts.jtlapp.net`.
- [x] `server/prisma/schema.prisma` comment on `LlmProxyToken`: forwards to OpenRouter (OpenAI Chat Completions, and the Anthropic-compatible endpoint planned for sprint 003), not "Anthropic Messages API".
- [x] `server/src/services/llm-proxy-token.service.ts` header: plaintext **is** stored in `token_plaintext` (and why), replacing "never persisted".
- [x] `README.md`: production database section states SQLite on a manager-pinned volume with the S3 backup job as the safety net, and that Postgres is supported but not used in prod; remove or correct the dual-adapter claim in the schema comment accordingly.
- [x] New `docs/deploy.md`: prerequisites (docker context `swarm1`, secrets synced via `npm run secrets-sync:prod`, `OPENROUTER_API_KEY` + `LLM_PROXY_MODEL_*` present), the exact commands (`npm run deploy:prod` / `scripts/up.sh prod`), smoke checks (`/api/health` version, `/proxy/v1/health` says `chat/completions`, `/proxy/v1/models` lists the three tiers, one authenticated `chat/completions` call increments `tokens_used`), rollback (redeploy previous `IMAGE_TAG`), and the new env/secrets this sprint adds (`DO_SPACES_*` already present for backups, `LAPTOP_ROSTER_BUCKET`, `LLM_PROXY_ANTHROPIC_ENABLED`).
- [x] `docs/deploy.md` also lists the one-time steps after deploy: run the laptop roster import (admin button) into "Botball 26", then "Push all laptop logins".

## Testing

- **Existing tests to run**: none affected; run `npm run test:server` once at the end of the sprint anyway.
- **New tests to write**: none.
- **Verification command**: `git diff --stat` shows only docs/comments; `cd server && npx tsc --noEmit`.

## Conventions for this sprint

- Server: TypeScript, Express, Prisma (SQLite in tests via `tests/server/setup.ts`). Run `npm run test:server` from the repo root; it takes ~3.5 minutes. `cd server && npx tsc --noEmit` must stay clean. Lint (`cd server && npm run lint`) has 12 pre-existing errors on master; add none.
- Client: React + Vite; `npm run test:client` (~20 s); `cd client && npx tsc --noEmit` clean.
- Services are constructor-injected and wired in `server/src/services/service.registry.ts`; routes read them from `req.services`. Fakes live in `tests/server/helpers/`.
- Audit events go through `AuditService` like the existing code (`grep -rn "audit" server/src/services/pike13/pike13-sync.service.ts` for the pattern).
- Prisma schema changes: edit `server/prisma/schema.prisma`, run `cd server && npx prisma migrate dev --name <slug>` (creates the migration under `server/prisma/migrations/`), regenerate the client. Confirm the generated client is committed if the repo commits it (`server/src/generated/` is tracked).
- Commit on the sprint branch after the ticket's tests pass, message starting with the ticket id (`[002-NNN] ...`). Do not bump the version (this repo's version lives in `package.json`; sprint close handles tagging).
- The issue file this ticket serves is in `clasi/sprints/002-laptop-accounts-live-in-student-accounts/issues/`; read it for the full design.
