---
id: '010'
title: Migrate docs to .claude/rules and update CLAUDE.md
status: done
use-cases:
- SUC-007
depends-on:
- '005'
- '006'
github-issue: ''
todo: migrate-docs-to-claude-instructions.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 010 — Migrate docs to .claude/rules and update CLAUDE.md

## Description

Move five agent-context documents from `docs/` into `.claude/rules/` by adding YAML
`paths:` front matter, then delete the originals and update `CLAUDE.md`.

Depends on tickets 005 and 006 because `docs/template-spec.md` is rewritten in ticket 006
to remove LEAGUEhub references — this ticket migrates the post-rewrite version. Migrating
before the rewrite would move stale content.

**Important — secrets.md collision:** `.claude/rules/secrets.md` already exists. Read
both the existing rule and `docs/secrets.md` before migrating. Options:
- Merge them into one file if they cover the same topic.
- Rename the migrated version to `docs-secrets.md` if they cover different scopes.
- Replace the existing rule if `docs/secrets.md` is more comprehensive.
Document your decision in the PR.

## Files to Migrate

| Source | Target | Suggested `paths:` |
|--------|--------|-------------------|
| `docs/api-integrations.md` | `.claude/rules/api-integrations.md` | `**/*` (reference for all sessions) |
| `docs/deployment.md` | `.claude/rules/deployment.md` | `docker/**,config/**,*.yaml` |
| `docs/secrets.md` | `.claude/rules/secrets.md` (or `docs-secrets.md`) | `config/**,.env*` |
| `docs/setup.md` | `.claude/rules/setup.md` | `**/*` |
| `docs/template-spec.md` | `.claude/rules/template-spec.md` | `**/*` |

## Steps per file

For each document:
1. Read the source file.
2. Read the target file if it already exists in `.claude/rules/` (check for collision).
3. Determine the appropriate `paths:` glob based on the document's content.
4. Add YAML front matter at the top:
   ```yaml
   ---
   paths:
     - "**/*"
   ---
   ```
5. Write the updated content to the `.claude/rules/` target path.
6. Delete the original from `docs/`.

## Files to Modify

**`CLAUDE.md`:**
After migrating all files, update the Documentation table. Remove or replace rows for
migrated files. The updated table should note that the migrated docs are now auto-loaded
as rules:
```md
## Documentation

Human-facing docs live in `docs/`. Consult them for reference:

- [docs/testing.md](docs/testing.md) — Full test strategy and patterns

Agent behavioral rules are in `.claude/rules/` (auto-loaded):

- `testing.md` — Test authentication, assertions, layer separation, SQLite
- `architecture.md` — Service layer, API conventions, database philosophy, dual DB support
- `secrets.md` — Secrets handling, security rules, config structure
- `rundbat.md` — Database and deployment MCP tools
- `api-integrations.md` — GitHub, Google OAuth setup
- `deployment.md` — Production builds, deployment
- `setup.md` — First-time checkout, install script, dev server
- `template-spec.md` — Technology decisions, project structure, conventions
```
Adjust the list to match what was actually migrated and how the secrets.md collision was
resolved.

**Verify no remaining references:**
After migration, search for any file still referencing the old `docs/` paths:
```
grep -r "docs/api-integrations\|docs/deployment\|docs/secrets\|docs/setup\|docs/template-spec" . --exclude-dir=node_modules
```
Fix any remaining references (except CLAUDE.md which you just updated).

## Acceptance Criteria

- [x] `docs/api-integrations.md` deleted; `.claude/rules/api-integrations.md` exists with `paths:` front matter
- [x] `docs/deployment.md` deleted; `.claude/rules/deployment.md` exists with `paths:` front matter
- [x] `docs/secrets.md` deleted; secrets content merged/replaced/renamed appropriately in `.claude/rules/`
- [x] `docs/setup.md` deleted; `.claude/rules/setup.md` exists with `paths:` front matter
- [x] `docs/template-spec.md` deleted; `.claude/rules/template-spec.md` exists with `paths:` front matter and post-reset content
- [x] `CLAUDE.md` Documentation table updated — no stale `docs/` links for migrated files
- [x] `grep -r "docs/api-integrations\|docs/deployment\|docs/secrets\|docs/setup\|docs/template-spec"` returns zero hits outside CLAUDE.md update context
- [x] `docs/testing.md` is NOT migrated (it is a human-facing test guide, not agent context)

## Implementation Plan

1. Read existing `.claude/rules/secrets.md` and `docs/secrets.md` — decide collision strategy.
2. For each of the five files: read source, determine `paths:`, write to `.claude/rules/`,
   delete original.
3. Edit `CLAUDE.md` — update Documentation section.
4. Run grep to verify no remaining stale references.

## Testing

- **Existing tests to run**: None (no code changes).
- **New tests to write**: None.
- **Verification**: `grep -r "docs/api-integrations\|docs/deployment\|docs/secrets\|docs/setup\|docs/template-spec" . --exclude-dir=node_modules` returns zero hits. All five `.claude/rules/` files exist and have valid YAML front matter.
