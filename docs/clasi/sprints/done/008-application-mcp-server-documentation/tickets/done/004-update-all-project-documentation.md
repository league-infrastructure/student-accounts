---
id: '004'
title: Update all project documentation
status: done
use-cases:
- SUC-005
depends-on: []
---

# Update all project documentation

## Description

Update all project documentation files to reflect the current state of the
template after sprints 004-008. The docs currently describe the pre-v2
architecture and are missing coverage of the config directory layout, service
layer, auth system, admin dashboard, UI shell, chat example app, and MCP
server.

### Changes

1. **`docs/template-spec.md`** — Major update:
   - Add `config/` directory to repository layout (replacing `secrets/`)
   - Add service layer section describing `ServiceRegistry`, service classes,
     and the pattern of thin route handlers delegating to services
   - Add MCP server section describing `server/src/mcp/`, tools, token auth,
     and `POST /api/mcp` endpoint
   - Update Docker architecture section for current Docker model
   - Add admin dashboard section describing admin features from sprint 006
   - Update repository layout tree to reflect all new directories and files

2. **`docs/secrets.md`** — Update for `config/` directory migration:
   - Document the `config/dev/` and `config/prod/` directory structure
   - Document the `public.env` / `secrets.env` split within each environment
   - Update SOPS commands to reference new file paths
   - Remove references to the old `secrets/` directory layout

3. **`docs/deployment.md`** — Update for new Docker model:
   - Update build and deploy commands for current Docker setup
   - Update secret loading to reference `config/` paths
   - Ensure rolling update instructions are current

4. **`docs/setup.md`** — Update for new first-time setup flow:
   - Document the `config/` directory and SOPS decryption steps
   - Update `npm run dev` workflow description
   - Ensure install script references are current

5. **`docs/testing.md`** — Update if test patterns have changed:
   - Verify test commands and directory references are accurate
   - Add any new testing patterns introduced in recent sprints

6. **`AGENTS.md`** — Add service layer guidance:
   - Document that business logic belongs in service classes, not route
     handlers
   - Document that routes are thin adapters that delegate to services
   - Document how to register new services in `ServiceRegistry`
   - Document the `source` parameter pattern for audit trails

## Acceptance Criteria

- [ ] `docs/template-spec.md` documents the `config/` directory layout
- [ ] `docs/template-spec.md` includes a service layer section
- [ ] `docs/template-spec.md` includes an MCP server section
- [ ] `docs/template-spec.md` repository layout tree is up to date
- [ ] `docs/template-spec.md` documents the admin dashboard
- [ ] `docs/secrets.md` documents the `config/` directory migration with `public.env`/`secrets.env` split
- [ ] `docs/deployment.md` reflects the current Docker model
- [ ] `docs/setup.md` reflects the current first-time setup flow
- [ ] `docs/testing.md` reflects current test patterns
- [ ] `AGENTS.md` includes service layer guidance for agents
- [ ] No documentation references stale paths (`secrets/dev.env`, etc.) or removed features
- [ ] All documentation is internally consistent across files

## Testing

- **Existing tests to run**: N/A (documentation-only changes)
- **New tests to write**: N/A
- **Verification command**: Review each doc file for internal consistency and
  accuracy against the current codebase
