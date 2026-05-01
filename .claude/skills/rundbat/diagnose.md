# diagnose

Read system and environment state, compare config against actual
container state, and report issues with specific remediation steps.

## When to use

- "My container won't start"
- "I can't connect to the database"
- "Something is wrong with my deployment"

## Steps

1. **Check Docker is running:**
   ```bash
   docker info
   ```

2. **Check container status:**
   ```bash
   docker compose -f docker/docker-compose.yml ps
   ```

3. **Check logs for errors:**
   ```bash
   docker compose -f docker/docker-compose.yml logs --tail 50
   ```

4. **Check config is correct:**
   ```bash
   dotconfig load -d <env> --json --flat -S
   ```
   Verify DATABASE_URL, ports, and service names match compose config.

5. **Check port conflicts:**
   ```bash
   docker inspect <container> --format '{{json .NetworkSettings.Ports}}'
   ```

6. **Report findings** with specific commands the developer should run.

## Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Container not running | Stopped or crashed | `docker compose up -d` |
| Connection refused | Wrong port or container down | Check compose ports, restart |
| SOPS decryption failed | Missing age key | `dotconfig keys` |
| Config not found | Not initialized | `rundbat init` |
| No Docker artifacts | Missing docker/ dir | `rundbat init-docker` |

## Swarm-specific diagnostics

When the deployment is `deploy_mode: stack`, `docker compose` commands
do not apply. Use the Swarm equivalents:

```bash
# Service and task-level state
docker --context <ctx> service ls                # services + replicas
docker --context <ctx> service ps <stack>_<svc>  # per-task status
docker --context <ctx> service ps <stack>_<svc> --no-trunc   # full error
docker --context <ctx> service logs -f <stack>_<svc>

# Cluster membership
docker --context <ctx> node ls                   # nodes + leader status

# Secrets available to the stack
docker --context <ctx> secret ls | grep <app>
```

| Symptom | Cause | Fix |
|---|---|---|
| Tasks stuck in `starting` / `pending` | Manager has no quorum, or insufficient resources | `docker node ls` — confirm a leader exists; check CPU/memory on the node |
| "no such service" on `rundbat logs` | Service name is `<stack>_<svc>`, not `<svc>` | Use `docker service ls` to see real names |
| "secret not found" | External secret name mismatch with generated compose | `docker secret ls`; see `docker-secrets-swarm` |
| Deploy succeeds but app unreachable | Caddy labels under top-level `labels:` are ignored in Swarm | `rundbat generate` — labels must live under `deploy.labels` |
| `invalid image reference for service app: no image specified` | Swarm cannot build — it pulls by `image:` tag. The deployment is missing the `image:` field (or the generated compose has only `build:`). | Set `deployments.<name>.image: <tag>` in `rundbat.yaml` and re-run `rundbat generate`. See `docker-swarm-deploy` → Image requirement. `rundbat generate` now catches this at generate time, so after upgrade the error surfaces earlier. |
