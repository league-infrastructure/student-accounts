# DigitalOcean Setup

Scripts for provisioning and configuring Docker droplets in The League's
Students team.

## Quick Start

1. **Set your DO token** (one-time, in `~/.zshenv`):
   ```bash
   export DO_LEAGUE_STUDENT_TOKEN="dop_v1_..."
   ```
   Generate at: DigitalOcean → The League org → Students team → API → Tokens

2. **Edit `config.env`** — Set the droplet name (e.g. `docker2`) and domain.

3. **Create a droplet:**
   ```bash
   ./digital-ocean/create-droplet.sh
   ```

4. **Point DNS** to the new droplet IP (managed externally).

5. **Set up the server** (Docker network + Caddy):
   ```bash
   ./digital-ocean/setup-server.sh <droplet-ip>
   ```

6. **Create a Docker context** for deploys:
   ```bash
   docker context create docker2 --docker 'host=ssh://root@<droplet-ip>'
   ```

## Files

| File | Purpose |
|------|---------|
| `config.env` | Droplet, project, and Caddy configuration |
| `create-droplet.sh` | Provisions a new droplet via `doctl` and assigns it to the App Deployment project |
| `setup-server.sh` | SSHes in, creates the `caddy` network, deploys the Caddy stack |
| `caddy-compose.yml` | Caddy reverse proxy stack (copied to `/opt/` on the server) |

## Architecture

```
Internet → Caddy (caddy-docker-proxy) → app containers on "caddy" network
```

**Caddy uses Docker labels for routing.** There is no Caddyfile. Each app
adds labels to its services:

```yaml
services:
  server:
    networks:
      - caddy
    labels:
      caddy: myapp.example.com
      caddy.reverse_proxy: "{{upstreams 3000}}"

networks:
  caddy:
    external: true
```

Caddy watches the Docker socket and automatically configures reverse proxy
routes and TLS certificates for any container with `caddy` labels on the
`caddy` network.

## Naming Convention

Droplets are named `dockerN` (e.g., `docker1`, `docker2`). Each is an
independent Docker host — no Swarm clustering.

## Smoke Tests

The Caddy stack includes two test services:

- `whoami.jtlapp.net` — echoes request headers (verifies Caddy routing)
- `hello.jtlapp.net` — simple hello-world page

Remove them from `caddy-compose.yml` once you've confirmed everything works.
