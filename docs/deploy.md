# Deploying student-accounts to production

Runbook for `https://student-accounts.jtlapp.net`. Written for the person who
runs the deploy by hand (sprint 002, ticket 009, 2026-10-18; extended for
sprint 003, ticket 006, same day). Every command below is copied from the
scripts in this repo; when a script and this page disagree, the script wins
and this page needs fixing.

## 1. What this deploy changes

Production currently runs **`0.20260616.6`**, the June build. Its LLM proxy
still forwards to the Anthropic Messages API (`GET /proxy/v1/health` answers
`"endpoint": "/proxy/v1/messages"`), and `GET /proxy/v1/models` returns the
SPA's `index.html` because that route does not exist in the old build.

Deploying current `master` brings three sprints at once:

| From | What lands |
|------|------------|
| Sprint 001 (OpenRouter proxy) | `/proxy/v1/chat/completions` (OpenAI Chat Completions shape) forwarding to OpenRouter; League model tiers `league-large` / `league-medium` / `league-small`; `/proxy/v1/models`. |
| Sprint 002 (laptop accounts) | SHA-512 crypt passwords, the laptop roster import and write-back to the Spaces bucket `jtl-student-unix-accounts`, admin set-username / set-password / email-credentials, laptop login cards, the fleet endpoint `POST /api/fleet/llm-token`, merge improvements. Two Prisma migrations, one new hourly job, new env keys (section 3). |
| Sprint 003 (LLM proxy budgets, Claude Code) | The proxy quota becomes a **monthly dollar budget** ($5 default, per-token override) with a per-request log (`LlmProxyRequest`); `/proxy/v1/messages` is back as an Anthropic-compatible passthrough so Claude Code works through the proxy (`LLM_PROXY_ANTHROPIC_ENABLED`, now default `true`); student page `/llm-proxy` with setup examples; admin LLM card and page `/admin/users/:id/llm-proxy`. One Prisma migration, one new daily job, new env keys, one post-deploy backfill (section 7b). |

The old build's `/proxy/v1/messages` forwarded straight to Anthropic with an
Anthropic key; the new one forwards to OpenRouter's Anthropic-compatible
endpoint with `OPENROUTER_API_KEY`. Same URL, different upstream.

Expect a short outage. The stack runs one replica with
`update_config.order: stop-first`, so the old container stops, the new one
starts, runs migrations (seconds on this database) and then passes its health
check (`start_period: 30s`). Plan for about a minute without service.

## 2. How the pieces fit

- **Image**: `ghcr.io/league-infrastructure/student-accounts:<IMAGE_TAG>`.
  `IMAGE_TAG` is always the `version` in the root `package.json`;
  `scripts/_lib.sh` reads it and refuses to run if it cannot. Images are built
  and pushed by `npm run build:image` (`scripts/build.sh`, multi-arch
  `linux/amd64,linux/arm64`, needs a `GITHUB_TOKEN` with `write:packages` and
  `read:user`). CI (`.github/workflows/ci.yml`) lints and tests; it does **not**
  build or push images.
- **Config**: `scripts/up.sh` calls `scripts/config-load.sh prod`, which runs
  `dotconfig load -d prod` to merge `config/prod/public.env` with the
  SOPS/age-encrypted `config/prod/secrets.env` into `.deploy/.env.prod`
  (mode 600, regenerated on every run). Swarm ignores `env_file:`, so `up.sh`
  renders the stack with `docker compose config` (which inlines the env file)
  to `.deploy/prod.stack.rendered.yaml` and deploys that. There are **no Docker
  swarm secrets**: `config/deploy.config.yaml` has `swarm_secrets: []`, so
  `npm run secrets-sync:prod` logs "nothing to do" and exits 0. Secrets reach
  the container as plain environment variables in the rendered stack.
- **Stack**: `docker-stack.yaml`, stack name `student-accounts`, service
  `student-accounts_web`, docker context `swarm1`
  (`ssh://root@swarm1.dojtl.net`). The stack's `environment:` block overrides
  the env file for `NODE_ENV=production`, `PORT=5201`,
  `DATABASE_URL=file:/app/data/app.db` and `APP_VERSION=<IMAGE_TAG>`, so the
  `DATABASE_URL=file:../data/dev.db` line in `config/prod/public.env` is only
  for running the prod config locally. Caddy (caddy-docker-proxy on the host)
  routes `student-accounts.jtlapp.net` to port 5201 from the
  `deploy.labels` in the stack file.
- **Database**: SQLite on the `app-data` volume, replica pinned to a manager
  node. The daily/weekly backup jobs upload copies to the Spaces bucket
  `DO_SPACES_BUCKET` (`league-student-storage`). Postgres is not used; see
  README "Production database".
- **Container start**: `docker/entrypoint.sh` runs
  `npx --no-install prisma migrate deploy` (reads `DATABASE_URL` through
  `/app/prisma.config.ts`), then `exec node dist/index.js`. Migrations are
  idempotent and run on every start. On boot the server calls
  `SchedulerService.seedDefaults()`, which upserts the scheduled jobs
  (`daily-backup`, `weekly-backup`, `workspace-delete`, `laptop-roster-push`,
  `llm-proxy-request-prune`), creating any missing one as enabled. It then
  runs `reconcileAccessFlags()`, which grants a token (default budget) to any
  user flagged `allows_llm_proxy` who has none.
- **Live vs restart-only config**: keys listed in `CONFIG_KEYS`
  (`server/src/services/config.ts`) are read through `getConfig()`:
  environment first, then the value saved on Admin → Configuration, then the
  code default, re-read on every use. The sprint 003 keys
  (`LLM_PROXY_ANTHROPIC_*`, `LLM_PROXY_DEFAULT_BUDGET_USD`,
  `LLM_PROXY_PRICE_*`) all work this way, so they can be changed from the
  admin UI without a redeploy **unless** the same key is set in the env,
  which wins. `LLM_PROXY_BASE_URL` and `LLM_PROXY_MODEL_*` are still read
  from `process.env` by the forwarder (see the table below).

## 3. New in this deploy: env keys, migrations, jobs, endpoints

### Env keys (where to set them)

| Key | Where | Required? | Notes |
|-----|-------|-----------|-------|
| `OPENROUTER_API_KEY` | `config/prod/secrets.env` | **Yes** | Without it every `chat/completions` call returns 503 "LLM proxy is not configured". The forwarder reads it from the environment (`LLM_PROXY_API_KEY` is an accepted alias). |
| `LLM_PROXY_BASE_URL` | `config/prod/public.env` | No | Default `https://openrouter.ai/api/v1/chat/completions`. |
| `LLM_PROXY_MODEL_LARGE` / `_MEDIUM` / `_SMALL` | `config/prod/public.env` | No | Code defaults `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v3.2`. The forwarder reads `process.env` directly, so a value saved on Admin → Configuration does **not** reach the proxy; set them in `public.env` and redeploy. |
| `LLM_PROXY_ANTHROPIC_ENABLED` | `config/prod/public.env` or Admin → Configuration | No | **Default `true`** (changed in sprint 003). Serves `POST /proxy/v1/messages` (Anthropic Messages protocol, passed through to OpenRouter) so Claude Code works with `ANTHROPIC_BASE_URL=https://student-accounts.jtlapp.net/proxy`; also makes `POST /api/fleet/llm-token` and the student/admin payloads advertise `anthropic_base_url` / `anthropicEndpoint`. **To turn it off** (if OpenRouter's Anthropic endpoint misbehaves): set it to `false` on Admin → Configuration (takes effect on the next request, no restart) or put `LLM_PROXY_ANTHROPIC_ENABLED=false` in `public.env` and redeploy. Off means the route answers 404 `{"error":"anthropic endpoint disabled"}` and the Claude Code example disappears from the student and admin pages. Only the literal string `true` enables it. |
| `LLM_PROXY_ANTHROPIC_BASE_URL` | `config/prod/public.env` or Admin → Configuration | No | Default `https://openrouter.ai/api/v1/messages`, OpenRouter's Anthropic-compatible Messages URL. Only change it to point at another Anthropic-shaped provider. |
| `LLM_PROXY_DEFAULT_BUDGET_USD` | `config/prod/public.env` or Admin → Configuration | No | Default `5` (dollars per UTC calendar month). Applied to new grants, auto-grants (fleet login, signup passphrase, startup reconcile) and the backfill in section 7b. Per-token overrides via the admin card or `PATCH /api/admin/llm-proxy/tokens/:id`; the admin-settable maximum is `1000`. A non-numeric or non-positive value falls back to 5. |
| `LLM_PROXY_PRICE_LARGE` / `_MEDIUM` / `_SMALL` | `config/prod/public.env` or Admin → Configuration | No | Fallback pricing, `"<usd per 1M input tokens>,<usd per 1M output tokens>"`, used only when OpenRouter omits `usage.cost` from a response (accounting must never record zero). Defaults `0.2088,0.4176` / `0.091,0.182` / `0.28,0.42`, OpenRouter's list prices for the default tier models fetched 2026-10-18. If you change `LLM_PROXY_MODEL_*`, update the matching price so the fallback stays honest. |
| `LAPTOP_ROSTER_SPACES_KEY` / `LAPTOP_ROSTER_SPACES_SECRET` | `config/prod/secrets.env` | **Yes** (set 2026-10-18) | The Spaces key that reads and writes the laptop roster bucket `jtl-student-unix-accounts`: the same key the laptops use (ubuntu-install's `DO_SPACES_KEY`). When unset the app falls back to `DO_SPACES_KEY` / `DO_SPACES_SECRET`. Changing these needs a redeploy (`requiresRestart`). |
| `DO_SPACES_KEY` / `DO_SPACES_SECRET` | `config/prod/secrets.env` | Already present (backups) | Backups to `league-student-storage` only (and the roster fallback). Note 2026-10-18: the key currently in prod config is denied on **both** buckets, so backups have not been uploading; rotate it in the DigitalOcean console (roadmap sprint 001 "Backup S3 upload fix"). |
| `DO_SPACES_ENDPOINT` / `DO_SPACES_REGION` / `DO_SPACES_BUCKET` | `config/prod/public.env` | Already present | Unchanged; `DO_SPACES_BUCKET` stays the backup bucket. |
| `LAPTOP_ROSTER_BUCKET` | `config/prod/public.env` | Already present | `jtl-student-unix-accounts` (also the code default). |

### Prisma migrations (applied automatically at container start)

- `20261018063004_laptop_password_hash`: `User.laptop_password_hash`
  (nullable), `CreatedVia.laptop_import`.
- `20261018072425_laptop_account_flags`: `User.allows_laptop_account`
  (default true), `User.laptop_roster_dirty` (default false).
- `20261018100456_llm_proxy_budgets` (sprint 003): `LlmProxyToken` gains
  `budget_usd` (nullable), `spent_usd`, `spent_usd_total` (default 0) and
  `period_start` (nullable); new table `LlmProxyRequest` (one row per proxied
  call: `token_id`, `user_id`, `ts`, `protocol`, `model_requested`,
  `model_sent`, `input_tokens`, `output_tokens`, `cost_usd`, `status`) with
  indexes on `(token_id, ts)` and `(user_id, ts)`. On SQLite Prisma rewrites
  `LlmProxyToken` as a new table and copies the rows (the `RedefineTables`
  block in the migration); with a few hundred tokens that is well under a
  second.

All three are additive: nullable or defaulted columns, one enum value, one
new table. Existing rows need no backfill to start, **but** existing proxy
tokens come out of the migration with `budget_usd = NULL`, which means they
keep enforcing the old lifetime token quota (`token_limit` / `tokens_used`)
until a budget is set. Section 7b sets the default budget on all of them in
one call.

### Scheduled jobs

- `laptop-roster-push`, hourly, enabled by default. Retries roster writes that
  failed during a user action (user flagged `laptop_roster_dirty`).
- `llm-proxy-request-prune` (sprint 003), daily, enabled by default. Deletes
  `LlmProxyRequest` rows older than 90 days
  (`server/src/jobs/llm-proxy-request-prune.job.ts`, `RETENTION_DAYS`). The
  running totals on `LlmProxyToken` keep the dollars after the rows are gone.
  A failed sweep is logged and retried on the next tick.

Both are visible on Admin → Scheduled Jobs; `POST
/api/admin/scheduler/jobs/:id/run` runs one now.

### Endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/fleet/llm-token`, `POST /api/fleet/llm-token/rotate` | none (username + password in body) | Laptops fetch the student's `llmp_` proxy token at login; auto-grants when missing. 401 on bad credentials, 429 after five failures per username or IP in 15 minutes. |
| `POST /api/admin/import/laptop-roster` | admin | One-time roster import (body `{ "groupName": "Botball 26" }`). |
| `POST /api/admin/laptop/push-all`, `POST /api/admin/users/:id/laptop/push` | admin | Rewrite every eligible roster entry / one user's entry. |
| `GET/PUT /api/admin/users/:id/credentials`, `POST /api/admin/users/:id/credentials/email` | admin | Set username and password, email them. |
| `POST /api/admin/users/:id/merge`, `POST /api/admin/merge-queue/rescan` | admin | Manual merge; rescan for duplicates. |
| `GET /proxy` | none | Self-documenting JSON for the proxy base URL: `protocols` (`["openai","anthropic"]` when the flag is on), `openaiBaseUrl`, `anthropicBaseUrl`, `messages`, the env variables each client needs. Replaces the SPA `index.html` a bare probe used to get. |
| `POST /proxy/v1/messages` | `llmp_` token (`x-api-key` or `Authorization: Bearer`) | Anthropic Messages protocol passed through to `LLM_PROXY_ANTHROPIC_BASE_URL`; `league-*` and `claude-*` model names map to the tiers; streaming preserved; usage recorded in dollars. 404 while `LLM_PROXY_ANTHROPIC_ENABLED` is not `true`. |
| `POST /proxy/v1/messages/count_tokens` | none | Always 404 with a JSON explanation: OpenRouter has no token-counting endpoint. Claude Code treats the 404 as "unsupported" and estimates locally; not an error. |
| `GET /api/admin/users/:id/llm-proxy`, `GET /api/admin/users/:id/llm-proxy/requests?limit=50` | admin | Token status with `budgetUsd` / `spentUsd` / `spentUsdTotal` / `periodResetsAt` (the older `…/llm-proxy-token` name still works); the user's most recent `LlmProxyRequest` rows, newest first (limit clamped to 500). |
| `PATCH /api/admin/llm-proxy/tokens/:id` | admin | Body `{ "budgetUsd": 10 }`: change one token's monthly budget without re-granting (0 < value ≤ 1000). Audited as `llm_proxy_budget_changed`. The admin LLM card's limit editor calls this. |
| `POST /api/admin/llm-proxy/backfill-budgets` | admin | Set `LLM_PROXY_DEFAULT_BUDGET_USD` on every token whose `budget_usd` is NULL. Idempotent; returns `{ "updated": N, "budgetUsd": 5 }`. Section 7b. |

## 4. Prerequisites

Run these from a checkout of this repo on the machine you deploy from.

```bash
cd /path/to/student-accounts
git checkout master && git pull --ff-only
git status --short                      # must be empty
node -p "require('./package.json').version"   # this is IMAGE_TAG
```

Deploy from the commit the sprint close tagged, so the version in
`package.json` matches the code. If you deploy an untagged `master`, bump the
version first (`dotconfig version bump`) and commit, otherwise the new image
would overwrite an existing tag in the registry.

Tools on the deploying machine: `docker` with the compose plugin, `yq`
(mikefarah's Go version; `_lib.sh` fails without it), `node`, `dotconfig`, and
the age key that decrypts `config/prod/secrets.env`.

```bash
# 1. Prod config decrypts and contains the keys the proxy and roster need.
#    Prints key names only; never paste the values anywhere.
scripts/config-load.sh prod | cut -d= -f1 | grep -E \
  '^(OPENROUTER_API_KEY|LLM_PROXY_(BASE_URL|MODEL_(LARGE|MEDIUM|SMALL)|PRICE_(LARGE|MEDIUM|SMALL)|ANTHROPIC_(ENABLED|BASE_URL)|DEFAULT_BUDGET_USD)|DO_SPACES_(KEY|SECRET|ENDPOINT|BUCKET|REGION)|LAPTOP_ROSTER_BUCKET|SESSION_SECRET|GOOGLE_CALLBACK_URL|GITHUB_CALLBACK_URL)$'
#    Must list at least OPENROUTER_API_KEY, DO_SPACES_KEY, DO_SPACES_SECRET and
#    LAPTOP_ROSTER_BUCKET. Every LLM_PROXY_* key is optional (defaults apply;
#    the sprint 003 ones can also be set later on Admin -> Configuration).

# 2. Docker context for the swarm.
docker context inspect swarm1 >/dev/null && echo "swarm1 ok"
#    If missing:  docker context create swarm1 --docker host=ssh://root@swarm1.dojtl.net
docker --context swarm1 node ls          # proves SSH + swarm access

# 3. Registry login (the swarm pulls with your credentials via --with-registry-auth).
docker login ghcr.io                     # username = your GitHub login, password = PAT with read:packages

# 4. The image for this version exists in the registry.
docker manifest inspect ghcr.io/league-infrastructure/student-accounts:$(node -p "require('./package.json').version") >/dev/null \
  && echo "image present" || echo "image missing: run npm run build:image"
```

Build the image if step 4 says it is missing (takes several minutes; the
builder is `docker buildx`, builder name `student-accounts-multiarch`):

```bash
GITHUB_TOKEN=<pat with write:packages and read:user> npm run build:image
```

Take a database backup you can restore from: Admin → Import/Export → create a
backup (`POST /api/admin/backups`). It uploads to Spaces when
`DO_SPACES_KEY`/`DO_SPACES_SECRET` are set; a local copy stays on the volume
either way.

## 5. Deploy

```bash
npm run secrets-sync:prod     # optional; prints "no swarm_secrets configured ... nothing to do"
npm run deploy:prod           # = scripts/up.sh prod
```

`scripts/up.sh prod` does, in order: write `.deploy/.env.prod` from dotconfig;
switch the docker context to `swarm1` (and back when it exits); render
`docker-stack.yaml` with the env inlined to `.deploy/prod.stack.rendered.yaml`
(using the local context, then `sed` out the `name:` line and quote `cpus`);
`docker stack deploy -c .deploy/prod.stack.rendered.yaml --with-registry-auth
student-accounts`. The log lines you should see:

```
[up] wrote .../.deploy/.env.prod (N lines)
[up] docker context: default -> swarm1
[up] rendering docker-stack.yaml -> .../.deploy/prod.stack.rendered.yaml
[up] deploying ghcr.io/league-infrastructure/student-accounts:<IMAGE_TAG>
[up] docker stack deploy -c .../.deploy/prod.stack.rendered.yaml student-accounts
Updating service student-accounts_web (id: ...)
```

Watch the rollout:

```bash
npm run ps:prod               # docker stack ps student-accounts: new task Running, old task Shutdown
npm run logs:prod             # docker service logs -f --tail=200 on the service
```

In the logs expect `[entrypoint] running prisma migrate deploy`, Prisma
reporting the three `20261018…` migrations applied (or "No pending migrations"
on a restart), `[entrypoint] starting: node dist/index.js`, then the server's
startup lines. If the new task fails its health check three times Swarm
rolls back on its own (`failure_action: rollback`); see section 8.

`.deploy/` is git-ignored and holds secrets in plain text; it is fine to leave
it, but do not copy it anywhere.

## 6. Smoke checks

```bash
BASE=https://student-accounts.jtlapp.net

curl -s $BASE/api/health
#  {"status":"ok","db":"ok","version":"<IMAGE_TAG>",...}   version must equal the tag you deployed

curl -s $BASE/proxy/v1/health
#  {"ok":true,"endpoint":"/proxy/v1/chat/completions","anthropicEndpoint":"/proxy/v1/messages"}
#  old build says {"ok":true,"endpoint":"/proxy/v1/messages"} with no "anthropicEndpoint" key;
#  anthropicEndpoint missing on the new build means LLM_PROXY_ANTHROPIC_ENABLED is off

curl -s $BASE/proxy
#  {"ok":true,"service":"llm-proxy","base":"https://student-accounts.jtlapp.net/proxy",
#   "protocols":["openai","anthropic"],"openaiBaseUrl":".../proxy/v1","anthropicBaseUrl":".../proxy",...}
#  HTML here means the old build is still serving (there was no GET /proxy before)

curl -s $BASE/proxy/v1/models
#  {"object":"list","data":[{"id":"league-large",...},{"id":"league-medium",...},{"id":"league-small",...}]}
#  HTML here means the old build is still serving

curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/fleet/llm-token \
  -H 'Content-Type: application/json' -d '{"username":"nobody","password":"x"}'
#  401 (route exists). Run this once: five failures from one IP in 15 minutes return 429.
```

Authenticated proxy calls and dollar accounting. Get a token: sign in as a
student who has proxy access and copy it from Account → LLM Proxy (the card
has a copy button; "Set up and details" opens `/llm-proxy`), or as an admin
open Admin → User Management → the user → LLM Proxy card (grant one if
needed; the card shows the masked key with reveal/copy and `$spent of $limit`;
`GET /api/admin/users/:id/llm-proxy` returns the same as `spentUsd` /
`budgetUsd`). Note `spentUsd` and the request count first, then:

```bash
TOKEN=llmp_...

# OpenAI protocol
curl -s $BASE/proxy/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"league-small","messages":[{"role":"user","content":"Say hi."}],"max_tokens":16}'
#  Chat Completions response with choices[0].message.content

# Anthropic protocol (sprint 003) — x-api-key, as the Anthropic SDK sends it
curl -s -X POST $BASE/proxy/v1/messages \
  -H "x-api-key: $TOKEN" -H "anthropic-version: 2023-06-01" -H 'Content-Type: application/json' \
  -d '{"model":"league-small","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'
#  Messages response: {"type":"message","role":"assistant","content":[{"type":"text","text":"..."}],
#   "usage":{"input_tokens":N,"output_tokens":M,...}}
#  404 {"error":"anthropic endpoint disabled"} means LLM_PROXY_ANTHROPIC_ENABLED is not "true"
```

Then Claude Code itself, from any machine with `claude` installed (this is
the same block the student `/llm-proxy` page prints, with the token filled
in; `ANTHROPIC_API_KEY=""` keeps a key lingering in the shell from overriding
the token):

```bash
ANTHROPIC_BASE_URL=$BASE/proxy ANTHROPIC_AUTH_TOKEN=$TOKEN ANTHROPIC_API_KEY="" claude -p "say hi"
```

A one-line reply means the whole chain works. Claude Code also calls
`/proxy/v1/messages/count_tokens`; that answers 404 on purpose (OpenRouter has
no counting endpoint) and Claude Code falls back to a local estimate, so a
404 for `count_tokens` in the logs is not a problem.

Now check the accounting. Reload the admin LLM Proxy card (or
`GET /api/admin/users/:id/llm-proxy`): `spentUsd` has gone up by a fraction
of a cent per call and `requestCount` by the number of calls (accounting is
fire-and-forget; give it a second). "Open LLM page" on the card
(`/admin/users/:id/llm-proxy`) shows a **recent requests** table with one row
per call: timestamp, protocol (`openai` / `anthropic`), the model requested
and the model actually sent, tokens, `cost_usd` and HTTP status. Those are
the new `LlmProxyRequest` rows; `GET /api/admin/users/:id/llm-proxy/requests`
returns the same as JSON. A row with a non-zero `costUsd` proves OpenRouter
returned `usage.cost` (or the `LLM_PROXY_PRICE_*` fallback kicked in). The
student's Account card and `/llm-proxy` page show the same figures as
`$spent of $limit` with the reset date. A 503 with "LLM proxy is not
configured" means `OPENROUTER_API_KEY` is missing from the rendered env.

Then in the admin UI:

- Admin → Scheduled Jobs lists `laptop-roster-push` (hourly, enabled) and
  `llm-proxy-request-prune` (daily, enabled).
- Admin → Configuration shows the "LLM Proxy" and "Laptop accounts" groups
  with source `environment` for `OPENROUTER_API_KEY`, `DO_SPACES_KEY`,
  `DO_SPACES_SECRET` and `LAPTOP_ROSTER_BUCKET`; the LLM Proxy group now also
  lists `Anthropic Endpoint Enabled` (`true`), `Anthropic Messages URL`,
  `Default Monthly Budget (USD)` (`5`) and the three `… Price` keys, all from
  their defaults unless you set them.
- Sign in with Google or GitHub once (callback URLs are unchanged, this just
  confirms sessions survive the restart).

## 7. One-time steps after this deploy (laptop accounts)

Do these once, after the smoke checks pass. Both actions are idempotent.

1. **Import the laptop roster.** Admin → User Management → "Import laptop
   roster…" (page header, admins only). Keep the group name **Botball 26**
   and confirm. The dialog reports `created` / `matched` / `skipped` /
   `errors`. A second run reports everything as matched. Imported students
   get a `username` login, their existing laptop password (SHA-512 crypt), a
   synthesised `<id>@laptop.invalid` email, and membership in "Botball 26";
   the merge scan runs for each new user, so duplicates of existing students
   show up on the Merge Queue page (`/merge-queue`). Review and approve them
   there; approving moves logins, groups, proxy token and laptop credentials
   to the survivor.

   Shell alternative, from the manager node, inside the running container.
   The runtime image has only the compiled `dist/` (no `tsx`, no `src/`), so
   the `npm run import:laptop-roster` wrapper from the source tree does not
   exist there; call the compiled script directly:

   ```bash
   CTR=$(docker --context swarm1 ps -q -f name=student-accounts_web)
   docker --context swarm1 exec -it "$CTR" node dist/scripts/import-laptop-roster.js --group "Botball 26"
   ```

   It prints the same report as JSON; exit 1 means some entries errored,
   exit 2 means the roster bucket is not configured. (From a development
   checkout with a prod `.env`, `cd server && npm run import:laptop-roster --
   --group "Botball 26"` runs the same code.)

2. **Push all laptop logins.** Same page header, "Push all laptop logins" →
   "Push all". This rewrites the roster entry for every active user with a
   username and password and locks (`password_hash: "!"`) the entry of anyone
   deactivated or opted out. The toast shows written / locked / unchanged /
   skipped / failed counts. Failures leave users `laptop_roster_dirty`; the hourly job
   retries, and a user's detail panel has a "Push now" button. Persistent
   failures mean the Spaces key cannot write `jtl-student-unix-accounts`.

3. **Check one laptop login end to end** when convenient: a student with a
   username and password set here chooses "Other…" on a League laptop and
   logs in; the laptop's `league-helper login` then calls
   `POST /api/fleet/llm-token` and the student's Account page shows the same
   token the laptop received.

## 7b. One-time step after this deploy (LLM proxy budgets)

Tokens that existed before the deploy have `budget_usd = NULL` and still
enforce the old lifetime token quota; the admin card shows "legacy token
quota; set a dollar limit to switch" for them. Give every such token the
default monthly budget in one call. There is no button for this (it is a
one-off migration step); call the endpoint from an admin session. Easiest:
sign in as an admin, open the browser devtools console on any page of the
app and run

```js
await (await fetch('/api/admin/llm-proxy/backfill-budgets', { method: 'POST' })).json()
//  → { updated: 42, budgetUsd: 5 }
```

Or with curl, using the session cookie from the browser (DevTools →
Application → Cookies → `connect.sid`):

```bash
curl -s -X POST $BASE/api/admin/llm-proxy/backfill-budgets -H "Cookie: connect.sid=<value>"
```

It is idempotent: a second run returns `{ "updated": 0, ... }`. The budget
it applies is whatever `LLM_PROXY_DEFAULT_BUDGET_USD` resolves to at that
moment (env → Admin → Configuration → `5`), so set that first if you want a
different default. Tokens granted after the deploy (admin grant, laptop
auto-grant, startup reconcile) get a budget automatically and are not
affected. After the backfill, spot-check one user: the admin card reads
`$0.00 of $5.00` (or whatever they have spent) and the student's Account card
shows the same with the first-of-next-month reset date. Individual limits can
be raised or lowered on the admin card at any time; the change is audited.

## 8. Rollback

**Automatic.** If the new task fails its health check, Swarm rolls the
service back to the previous spec (`failure_action: rollback`). `npm run
ps:prod` shows the old image Running again. Read `npm run logs:prod` for the
cause before retrying.

**Manual, one step back** (restores the previous image *and* its
environment, including `APP_VERSION`):

```bash
docker --context swarm1 service rollback student-accounts_web
docker --context swarm1 service ps student-accounts_web
```

**Manual, to a specific tag.** `scripts/_lib.sh` always takes `IMAGE_TAG` from
`package.json` (an exported `IMAGE_TAG` is overwritten), and the repo has no
`v0.20260616.6` tag, so set the version temporarily:

```bash
node -e 'const fs=require("fs");const p=require("./package.json");p.version="0.20260616.6";fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
npm run deploy:prod
git checkout package.json
```

**Anthropic endpoint only.** If just `/proxy/v1/messages` misbehaves (bad
replies from OpenRouter's Anthropic surface, Claude Code errors), do not roll
the deploy back: set `LLM_PROXY_ANTHROPIC_ENABLED` to `false` on Admin →
Configuration. The route answers 404 from the next request on, the Claude
Code example disappears from the student/admin pages and `POST
/api/fleet/llm-token` stops sending `anthropic_base_url`; the OpenAI path is
untouched. Flip it back the same way. (If the key is set in `public.env`, the
env value wins and you need a redeploy instead.)

**Database.** The three migrations are additive, and the old build ignores
the new columns and the `LlmProxyRequest` table (the June build never reads
them), so rolling back the code does not require rolling back the database;
you only lose the dollar accounting that happened while the new build was up
if you also restore a backup. The exception is the laptop roster import:
**if the import or any laptop account action already ran**, users created by
the import carry `created_via = laptop_import`, a value the old Prisma client
does not know and refuses to read, so those
users would break admin pages in the old build. If you must roll back after
the import, restore the pre-deploy backup (Admin → Import/Export →
restore, `POST /api/admin/backups/:id/restore`) or delete the imported users
first. Easiest: run the one-time steps in section 7 only after you are sure
you are staying on the new build.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `IMAGE_TAG not set — run via scripts/up.sh` | `docker stack deploy` was run directly. Use `npm run deploy:prod`. |
| `yq (mikefarah Go version) is required` | Install `yq` (not the Python `yq`). |
| `docker context 'swarm1' not found` | `docker context create swarm1 --docker host=ssh://root@swarm1.dojtl.net`. |
| `error: no config source found for env 'prod'` | `dotconfig` missing, or `config/prod/` not present. |
| dotconfig cannot decrypt `secrets.env` | The age key for this repo's SOPS config is not on this machine. |
| Task stuck in `Preparing` / `No such image` | The swarm node cannot pull: image not built for this tag (section 4 step 4), or you were not logged in to ghcr.io when running `deploy:prod` (`--with-registry-auth` forwards the local login). |
| `/api/health` shows the old version after deploy | Rollout still in progress or it rolled back: `npm run ps:prod`, `npm run logs:prod`. |
| `/proxy/v1/models` returns HTML | Old build still serving (same as above). |
| `chat/completions` or `messages` → 503 "LLM proxy is not configured" | `OPENROUTER_API_KEY` missing from `config/prod/secrets.env`; add, then `npm run deploy:prod`. |
| `POST /proxy/v1/messages` → 404 `anthropic endpoint disabled` | `LLM_PROXY_ANTHROPIC_ENABLED` is not the string `true`: check Admin → Configuration and `public.env` (env wins). |
| `POST /proxy/v1/messages/count_tokens` → 404 | Expected; OpenRouter has no counting endpoint and Claude Code estimates locally. Nothing to fix. |
| Proxy call → 429 `monthly budget of $5.00 reached; resets 2026-11-01` | The student spent their month's budget. Raise the limit on the admin LLM card (`PATCH /api/admin/llm-proxy/tokens/:id`) or wait for the UTC month to roll; the reset is applied lazily on their next request. |
| Proxy call → 429 `LLM proxy token quota exhausted` | A legacy token (`budget_usd` NULL) hit its old lifetime token limit. Run the backfill in section 7b, or set a dollar limit on that user's admin card; either switches the token to the monthly budget. |
| Admin card says "legacy token quota; set a dollar limit to switch" | Same cause: section 7b has not run for that token. |
| Request rows show `costUsd: 0`, or spend does not move | OpenRouter omitted `usage.cost` **and** the fallback price for that tier is unparseable. `LLM_PROXY_PRICE_*` must be `"<in>,<out>"` in USD per 1M tokens; fix on Admin → Configuration. Also check the server log for `recordUsage` errors (accounting is fire-and-forget). |
| Claude Code hangs or answers with an OpenAI-shaped error | `ANTHROPIC_BASE_URL` must be `…/proxy` (no `/v1`; the SDK appends `/v1/messages`) and the token goes in `ANTHROPIC_AUTH_TOKEN`, with `ANTHROPIC_API_KEY=""`. Copy the block from `/llm-proxy` rather than typing it. |
| Import/Push all → "not configured" | `DO_SPACES_KEY`/`DO_SPACES_SECRET` missing from the rendered env (they require a restart to take effect). |
| Push all reports failures, users stay dirty | The Spaces key lacks write access on `jtl-student-unix-accounts`; fix in the DigitalOcean console, then "Push all" again or wait for the hourly job. |
| Google/GitHub sign-in redirect mismatch | Callback URLs must be `https://student-accounts.jtlapp.net/api/auth/{google,github}/callback` both in `config/prod/public.env` and in the provider console. |
