# Deploying student-accounts to production

Runbook for `https://student-accounts.jtlapp.net`. Written for the person who
runs the deploy by hand (sprint 002, ticket 009, 2026-10-18). Every command
below is copied from the scripts in this repo; when a script and this page
disagree, the script wins and this page needs fixing.

## 1. What this deploy changes

Production currently runs **`0.20260616.6`**, the June build. Its LLM proxy
still forwards to the Anthropic Messages API (`GET /proxy/v1/health` answers
`"endpoint": "/proxy/v1/messages"`), and `GET /proxy/v1/models` returns the
SPA's `index.html` because that route does not exist in the old build.

Deploying current `master` brings two sprints at once:

| From | What lands |
|------|------------|
| Sprint 001 (OpenRouter proxy) | `/proxy/v1/chat/completions` (OpenAI Chat Completions shape) forwarding to OpenRouter; League model tiers `league-large` / `league-medium` / `league-small`; `/proxy/v1/models`. `/proxy/v1/messages` is gone until sprint 003 re-adds it behind `LLM_PROXY_ANTHROPIC_ENABLED`. |
| Sprint 002 (laptop accounts) | SHA-512 crypt passwords, the laptop roster import and write-back to the Spaces bucket `jtl-student-unix-accounts`, admin set-username / set-password / email-credentials, laptop login cards, the fleet endpoint `POST /api/fleet/llm-token`, merge improvements. Two Prisma migrations, one new hourly job, new env keys (section 3). |

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
  (`daily-backup`, `weekly-backup`, `workspace-delete`, `laptop-roster-push`),
  creating any missing one as enabled.

## 3. New in this deploy: env keys, migrations, jobs, endpoints

### Env keys (where to set them)

| Key | Where | Required? | Notes |
|-----|-------|-----------|-------|
| `OPENROUTER_API_KEY` | `config/prod/secrets.env` | **Yes** | Without it every `chat/completions` call returns 503 "LLM proxy is not configured". The forwarder reads it from the environment (`LLM_PROXY_API_KEY` is an accepted alias). |
| `LLM_PROXY_BASE_URL` | `config/prod/public.env` | No | Default `https://openrouter.ai/api/v1/chat/completions`. |
| `LLM_PROXY_MODEL_LARGE` / `_MEDIUM` / `_SMALL` | `config/prod/public.env` | No | Code defaults `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v3.2`. The forwarder reads `process.env` directly, so a value saved on Admin → Configuration does **not** reach the proxy; set them in `public.env` and redeploy. |
| `LLM_PROXY_ANTHROPIC_ENABLED` | `config/prod/public.env` | No | Leave unset. Default `false`; sprint 003 turns on the Anthropic-compatible endpoint. Today it only changes which base URLs `POST /api/fleet/llm-token` returns to the laptops. |
| `DO_SPACES_KEY` / `DO_SPACES_SECRET` | `config/prod/secrets.env` | Already present (backups) | The same key now also reads and writes the laptop roster. In the DigitalOcean console confirm the key has read+write on **both** `league-student-storage` and `jtl-student-unix-accounts` (or is an all-buckets key). Changing these needs a redeploy (`requiresRestart`). |
| `DO_SPACES_ENDPOINT` / `DO_SPACES_REGION` / `DO_SPACES_BUCKET` | `config/prod/public.env` | Already present | Unchanged; `DO_SPACES_BUCKET` stays the backup bucket. |
| `LAPTOP_ROSTER_BUCKET` | `config/prod/public.env` | Already present | `jtl-student-unix-accounts` (also the code default). |

### Prisma migrations (applied automatically at container start)

- `20261018063004_laptop_password_hash`: `User.laptop_password_hash`
  (nullable), `CreatedVia.laptop_import`.
- `20261018072425_laptop_account_flags`: `User.allows_laptop_account`
  (default true), `User.laptop_roster_dirty` (default false).

Both are additive: nullable or defaulted columns plus one enum value. Existing
rows need no backfill.

### Scheduled job

`laptop-roster-push`, hourly, enabled by default. Retries roster writes that
failed during a user action (user flagged `laptop_roster_dirty`). Visible on
Admin → Scheduled Jobs; `POST /api/admin/scheduler/jobs/:id/run` runs it now.

### Endpoints

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /api/fleet/llm-token`, `POST /api/fleet/llm-token/rotate` | none (username + password in body) | Laptops fetch the student's `llmp_` proxy token at login; auto-grants when missing. 401 on bad credentials, 429 after five failures per username or IP in 15 minutes. |
| `POST /api/admin/import/laptop-roster` | admin | One-time roster import (body `{ "groupName": "Botball 26" }`). |
| `POST /api/admin/laptop/push-all`, `POST /api/admin/users/:id/laptop/push` | admin | Rewrite every eligible roster entry / one user's entry. |
| `GET/PUT /api/admin/users/:id/credentials`, `POST /api/admin/users/:id/credentials/email` | admin | Set username and password, email them. |
| `POST /api/admin/users/:id/merge`, `POST /api/admin/merge-queue/rescan` | admin | Manual merge; rescan for duplicates. |

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
  '^(OPENROUTER_API_KEY|LLM_PROXY_(BASE_URL|MODEL_(LARGE|MEDIUM|SMALL)|ANTHROPIC_ENABLED)|DO_SPACES_(KEY|SECRET|ENDPOINT|BUCKET|REGION)|LAPTOP_ROSTER_BUCKET|SESSION_SECRET|GOOGLE_CALLBACK_URL|GITHUB_CALLBACK_URL)$'
#    Must list at least OPENROUTER_API_KEY, DO_SPACES_KEY, DO_SPACES_SECRET and
#    LAPTOP_ROSTER_BUCKET. LLM_PROXY_MODEL_* are optional (defaults apply).

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
reporting the two `20261018…` migrations applied (or "No pending migrations"
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
#  {"ok":true,"endpoint":"/proxy/v1/chat/completions"}     old build says /proxy/v1/messages

curl -s $BASE/proxy/v1/models
#  {"object":"list","data":[{"id":"league-large",...},{"id":"league-medium",...},{"id":"league-small",...}]}
#  HTML here means the old build is still serving

curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/fleet/llm-token \
  -H 'Content-Type: application/json' -d '{"username":"nobody","password":"x"}'
#  401 (route exists). Run this once: five failures from one IP in 15 minutes return 429.
```

Authenticated proxy call and usage accounting. Get a token: sign in as a
student who has proxy access and copy it from Account → LLM Proxy, or as an
admin open Admin → User Management → the user → LLM Proxy card (grant one if
needed; `GET /api/admin/users/:id/llm-proxy-token` returns `tokensUsed`). Note
`tokensUsed` first, then:

```bash
curl -s $BASE/proxy/v1/chat/completions \
  -H "Authorization: Bearer llmp_..." -H 'Content-Type: application/json' \
  -d '{"model":"league-small","messages":[{"role":"user","content":"Say hi."}],"max_tokens":16}'
```

Expect a Chat Completions response with `choices[0].message.content`. Reload
the LLM Proxy card: `tokensUsed` increased by the response's
`usage.total_tokens` (accounting is fire-and-forget; give it a second). A 503
with "LLM proxy is not configured" means `OPENROUTER_API_KEY` is missing from
the rendered env.

Then in the admin UI:

- Admin → Scheduled Jobs lists `laptop-roster-push` (hourly, enabled).
- Admin → Configuration shows the "LLM Proxy" and "Laptop accounts" groups
  with source `environment` for `OPENROUTER_API_KEY`, `DO_SPACES_KEY`,
  `DO_SPACES_SECRET` and `LAPTOP_ROSTER_BUCKET`.
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

**Database.** The two migrations are additive, and the old build ignores the
new columns, so rolling back the code does not require rolling back the
database, **unless the roster import or any laptop account action already
ran**: users created by the import carry `created_via = laptop_import`, a
value the old Prisma client does not know and refuses to read, so those
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
| `chat/completions` → 503 "LLM proxy is not configured" | `OPENROUTER_API_KEY` missing from `config/prod/secrets.env`; add, then `npm run deploy:prod`. |
| Import/Push all → "not configured" | `DO_SPACES_KEY`/`DO_SPACES_SECRET` missing from the rendered env (they require a restart to take effect). |
| Push all reports failures, users stay dirty | The Spaces key lacks write access on `jtl-student-unix-accounts`; fix in the DigitalOcean console, then "Push all" again or wait for the hourly job. |
| Google/GitHub sign-in redirect mismatch | Callback URLs must be `https://student-accounts.jtlapp.net/api/auth/{google,github}/callback` both in `config/prod/public.env` and in the provider console. |
