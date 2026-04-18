---
title: 'Install Script: CLASI Reset for New Projects'
type: todo
priority: high
status: done
sprint: '016'
tickets:
- '002'
---

# Install Script: CLASI Reset for New Projects

## Problem

This repo is built and maintained using CLASI (sprints, tickets, TODOs, reflections, architecture docs). When a student clones the template to start their own project, all of that CLASI history is irrelevant — it's the development history of the *template itself*, not their project.

Currently 158 files / 884K of CLASI docs ship with the template:
- `docs/clasi/sprints/done/` — 15 completed sprints with tickets
- `docs/clasi/todo/done/` — ~30 completed TODOs
- `docs/clasi/todo/` — 3 active TODOs (template-specific)
- `docs/clasi/reflections/` — agent self-reflections
- `docs/clasi/architecture/` — architecture snapshots
- `docs/clasi/.clasi.db` — CLASI state database

Students need to start fresh with an empty CLASI project for *their* app.

## What Needs to Happen

### 1. Audit the install script (`scripts/install.sh`)

The install script already has a CLASI section (step 6) that installs the `clasi` CLI and runs `clasi init`. Verify:
- Is it correctly installing CLASI?
- Does `clasi init` work correctly on a fresh clone?
- Is the npm dependency installation still correct? (root, server, client)
- Is the Docker detection logic still accurate?
- Is the secrets/SOPS flow still current?

### 2. Add CLASI reset to the install script

Add a new step (before or as part of the CLASI section) that:
- Detects this is a fresh clone (e.g., CLASI DB exists with template sprint history)
- Removes all template-specific CLASI artifacts:
  - `docs/clasi/sprints/done/*`
  - `docs/clasi/todo/done/*`
  - `docs/clasi/todo/*.md` (template-specific active TODOs)
  - `docs/clasi/reflections/*`
  - `docs/clasi/architecture/done/*`
  - `docs/clasi/.clasi.db`
- Preserves the directory structure (empty `sprints/`, `todo/`, etc.)
- Runs `clasi init` to create a fresh CLASI database for the student's project
- Logs what it did so the student understands

### 3. Ensure students must run the install script

- README should make it crystal clear: clone, then run `scripts/install.sh`
- The install script is the canonical entry point — not `npm install`
- Consider adding a sentinel file (e.g., `.initialized`) that `npm run dev` checks for, warning if the install script hasn't been run

## Notes

- The local development copy of the template (our working repo) should NOT be affected — this only runs on fresh clones
- The CLASI CLI's `clasi init` should handle creating a fresh `.clasi.db` and `.mcp.json` entry
- Template-specific TODOs (audit-logging, image-storage, mcp-oauth-flow) should be removed since they're about the template, not the student's project
