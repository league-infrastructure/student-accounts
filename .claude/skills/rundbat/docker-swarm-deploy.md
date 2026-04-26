# docker-swarm-deploy

Deploy and operate rundbat-managed applications on Docker Swarm. Covers
detection, lifecycle, secrets, and troubleshooting.

## When to use

- The stakeholder mentions Docker Swarm, stacks, or `docker stack deploy`.
- A deployment has `swarm: true` or `deploy_mode: stack` in `rundbat.yaml`.
- The deploy target runs `docker swarm init` (single-node or multi-manager).
- The app needs managed service secrets, rolling updates, or restart
  policies enforced by the orchestrator — not by `restart: unless-stopped`
  in a compose file.

Skip this skill when the target is plain `docker compose` without Swarm.
Use `deploy-init` and `deploy-setup` instead.

## When to prefer Swarm over plain compose

| Need | Compose | Swarm stack |
|---|---|---|
| Single container, single host | Fine | Overkill |
| Managed secrets (not env vars) | No | Yes — see `docker-secrets-swarm` |
| Rolling updates with health-check gating | Manual | `update_config.order: start-first` |
| Restart on failure with backoff | `restart: unless-stopped` | `restart_policy: on-failure` |
| Service discovery across hosts | No | Built-in overlay networks |
| Multiple replicas behind a VIP | No | `deploy.replicas` |
| Deploying from CI | `docker compose -f` over SSH | `docker stack deploy` (idempotent) |

**One-node Swarm is a valid middle ground.** Run `docker swarm init`
on a single host and stop there — you get managed secrets and rolling
updates without running a cluster. rundbat supports this: the probe
reports `swarm_role: manager`, and `deploy_mode: stack` works
identically to multi-manager setups.

## How rundbat detects Swarm

`rundbat probe <env>` calls `docker --context <ctx> info --format
'{{json .Swarm}}'` and writes the result to the deployment entry:

```yaml
deployments:
  prod:
    swarm: true           # or false / "unknown"
    swarm_role: manager   # "manager" | "worker" | omitted
```

Transient failures (unreachable host, auth error) report
`swarm: unknown` and never silently downgrade a prior `swarm: true` —
the probe only upgrades knowledge.

## Stack lifecycle

When a deployment has `deploy_mode: stack` (or is auto-upgraded because
`swarm: true` is set without an explicit mode), the lifecycle commands
call `docker stack …` / `docker service …` under the hood:

| rundbat command | Shells out to |
|---|---|
| `rundbat up <env>` | `docker --context <ctx> stack deploy -c docker/docker-compose.<env>.yml <stack>` |
| `rundbat down <env>` | `docker --context <ctx> stack rm <stack>` |
| `rundbat restart <env>` | `stack rm` then `stack deploy` |
| `rundbat logs <env>` | `docker --context <ctx> service logs -f <stack>_<service>` |

Stack name defaults to `<app_name>_<deployment_name>`. Override with
`stack_name: <whatever>` in the deployment entry — useful when the
same cluster hosts multiple environments.

`rundbat build <env>` still uses `docker compose build`. Build is not
a stack operation.

## Auto-upgrade rule

If the probe recorded `swarm: true` AND the deployment has
`swarm: true`, rundbat lifecycle commands auto-upgrade to stack mode
even if `deploy_mode` is absent. Explicit `deploy_mode: compose` on a
`swarm: true` deployment still wins — the user is in charge.

## Image requirement

**Every Swarm deployment must declare an `image:` on the deployment
entry.** Swarm does not build images; it pulls them by tag. A stack
compose that only has `build:` deploys with the opaque failure
`invalid image reference for service app: no image specified`.

```yaml
deployments:
  prod:
    swarm: true
    deploy_mode: stack
    build_strategy: ssh-transfer
    image: myapp:prod          # required when swarm: true
    docker_context: swarm1
```

`rundbat generate` validates this at generate time. If `swarm: true`
is set and `image:` is missing, generation fails with a clear error
and writes no compose file.

How each `build_strategy` satisfies the requirement:

| Strategy | Where the image comes from |
|---|---|
| `github-actions` | Workflow pushes `ghcr.io/<owner>/<repo>:latest`; the deployment's `image:` field references it (defaulted to `ghcr.io/owner/<app>:latest` if omitted). |
| `context` | An image with the declared tag must already exist on the remote (e.g. previously built via `rundbat build`) or be pullable from a registry. Use this when the remote builds on its own schedule. |
| `ssh-transfer` | `rundbat build` tags the local image with the declared `image:`; `rundbat up` `docker save`/`load`s it to the swarm nodes. The tag in compose and the transferred tag always match. |

For `context` and `ssh-transfer`, generated compose emits **both**
`image:` and `build:` — `docker compose build` uses `build:` to
produce a locally-tagged image; `docker stack deploy` uses `image:`
to pull it on the swarm nodes.

## Secrets

See `docker-secrets-swarm` for the full workflow. Short version:

1. Declare `secrets: [KEY_ONE, KEY_TWO]` on the deployment.
2. `rundbat generate` emits the `secrets:` stanzas (`external: true`)
   and per-service attachments.
3. `rundbat secret create <env> <KEY>` pipes the dotconfig value into
   `docker secret create <app>_<key_lc>_v<YYYYMMDD> -`.

Rotation is additive — create the new versioned secret, update the
stack to point at it, remove the old one after the rollout.

## deploy-init flow

`rundbat deploy-init <name> --host ssh://...`:

1. Creates the Docker context and verifies SSH access.
2. Probes the remote for Caddy and Swarm.
3. If Swarm is detected, prompts: *"Enable stack mode (swarm: true,
   deploy_mode: stack)? [Y/n]"*
4. On accept, writes `swarm: true` + `deploy_mode: stack` to the new
   deployment entry. On decline, the deployment stays in compose mode.

Non-interactive runs (`--json`) auto-accept the opt-in when Swarm is
detected.

## Troubleshooting quick-ref

| Symptom | First check |
|---|---|
| `rundbat up` hangs with "starting" tasks | `docker --context <ctx> node ls` — lost quorum means the manager cannot schedule tasks. |
| "no such service" on `rundbat logs` | `docker --context <ctx> service ls` — the service name is `<stack>_<service>`, not `<service>`. |
| Tasks crash-loop with "secret not found" | `docker --context <ctx> secret ls \| grep <app>` — the external secret name in compose must resolve. |
| "cannot update" on deploy | `docker --context <ctx> service ps <stack>_<svc> --no-trunc` — task-level errors live here, not in service logs. |
| Routing broken after swarm enable | Caddy labels must live under `services.<svc>.deploy.labels`, not top-level `labels:`. `rundbat generate` handles this — re-run it. |
| `invalid image reference for service app: no image specified` | The deployment needs `image: <tag>` set. See the **Image requirement** section above. `rundbat generate` now catches this at generate time. |

Useful commands when a stack misbehaves:

```bash
docker --context <ctx> node ls                   # cluster membership
docker --context <ctx> service ls                # services + replicas
docker --context <ctx> service ps <stack>_app    # task history
docker --context <ctx> service logs -f <stack>_app
docker --context <ctx> stack services <stack>    # services in one stack
docker --context <ctx> secret ls                 # what's available to mount
```

## References

- `docker-secrets-swarm` — secret creation, rotation, preflight checks
- `deploy-init` — initial deploy setup and the Swarm opt-in prompt
- `diagnose` — general deployment troubleshooting
- https://docs.docker.com/engine/swarm/stack-deploy/
