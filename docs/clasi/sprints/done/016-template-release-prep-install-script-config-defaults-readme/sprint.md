---
id: '016'
title: "Template Release Prep \u2014 Install Script, Config Defaults, README"
status: done
branch: sprint/016-template-release-prep-install-script-config-defaults-readme
use-cases: []
---

# Sprint 016: Template Release Prep — Install Script, Config Defaults, README

## Goals

Make the template clone-ready for students. A student should be able to clone, run the install script, and `npm run dev` with zero manual config.

## Problem

The template was built using CLASI over 15 sprints, accumulating 158 files of development history (done sprints, tickets, reflections, architecture snapshots). Several scripts reference obsolete SOPS/age encryption workflows. The default database config points at PostgreSQL (requires Docker), and the README doesn't lead with the student experience.

## Solution

1. Update the install script to clear CLASI history and re-initialize for the student's project
2. Remove obsolete encryption scripts and package.json entries
3. Default DATABASE_URL to SQLite in config
4. Rewrite the README to lead with "clone → install → dev"

## Success Criteria

- Fresh clone + `scripts/install.sh` + `npm run dev` works with zero manual steps
- CLASI history is wiped on install, fresh project initialized
- No references to SOPS/age encryption remain in scripts or package.json
- README leads with getting started instructions
- Config defaults to SQLite

## Scope

### In Scope

- Install script: add CLASI reset step, remove SOPS/age sections
- Scripts directory: remove obsolete encryption scripts
- package.json: remove `secrets:add-key` entry
- config/dev/public.env: default to SQLite
- README: rewrite for student experience

### Out of Scope

- MCP OAuth flow TODO (deferred)
- Audit logging, image storage TODOs (deferred)
- Production deployment changes
- New features

## Test Strategy

Manual verification: clone to a temp directory, run install script, confirm `npm run dev` starts with SQLite. No automated tests needed — this is scripts and docs.

## Architecture Notes

No architectural changes. This sprint is about DX tooling and documentation.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

1. Audit and remove obsolete encryption scripts
2. Update install script with CLASI reset
3. Default database config to SQLite
4. Rewrite README
