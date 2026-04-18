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
