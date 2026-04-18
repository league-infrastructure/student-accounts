---
status: done
sprint: 018
tickets:
- 018-010
---

# Migrate Agent Docs to .claude/rules Instructions

## Context

Several documents in `docs/` exist solely to provide context for agents
and belong in `.claude/rules/` as instruction files with YAML front
matter. Moving them out of `docs/` removes human-facing clutter and
ensures agents auto-load them via the rules system.

## Documents to migrate

| File | Target rule file | Notes |
|------|-----------------|-------|
| `docs/api-integrations.md` | `.claude/rules/api-integrations.md` | GitHub, Google, Pike 13 OAuth setup |
| `docs/deployment.md` | `.claude/rules/deployment.md` | Production builds and deployment |
| `docs/secrets.md` | `.claude/rules/secrets.md` | Secrets inventory and onboarding (may overlap with existing `secrets.md` rule — review first) |
| `docs/setup.md` | `.claude/rules/setup.md` | First-time checkout, install script, dev server |
| `docs/template-spec.md` | `.claude/rules/template-spec.md` | Technology decisions, project structure, conventions |

## Steps

1. Review each document and determine the appropriate `paths:` glob for
   its front matter (e.g. deployment-related files, all files, etc.).
2. Add YAML front matter with `paths:` to each document.
3. Copy the file to `.claude/rules/` with the target filename.
4. Remove the original from `docs/`.
5. Update `CLAUDE.md` to remove the docs reference table rows for any
   migrated files (or replace with a note that they are now auto-loaded
   as rules).
6. Verify no other files reference the old `docs/` paths.
