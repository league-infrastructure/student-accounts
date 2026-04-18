---
status: done
---

# Update Dev Script and Install Script for Template vs Project Workflows

## Context

There are two distinct use cases for this template:

1. **Developing the template itself** — a contributor working on the
   template repo wants to run installations but keep CLASI artifacts intact.
2. **Starting a new project from the template** — a new user clones and
   runs an install that wipes CLASI history unconditionally.

Currently `scripts/dev.sh` only starts the dev server; it does none of
the setup that `scripts/install.sh` performs. And `install.sh` currently
auto-detects the template remote to decide whether to preserve CLASI,
but the desired behavior is: **install always deletes CLASI**, **dev
never touches CLASI**.

## Changes

### 1. `scripts/dev.sh` — full setup without CLASI changes

Transform `dev.sh` from a "start the server" script into a full setup
script that mirrors `install.sh` but skips the CLASI reset entirely.
Steps it should perform (in order):

- Install npm dependencies (root, server, client)
- Docker context detection
- Check age/SOPS tools
- Install/verify Python tools (clasi, dotconfig, rundbat) via pipx
- Run `dotconfig init` and `rundbat init`
- Generate `.env` if missing
- **Do not touch `docs/clasi/` at all**
- After setup, start the dev server (or print instructions to run
  `npm run dev`)

### 2. `scripts/install.sh` — always delete CLASI, no prompt

Remove the git-remote detection logic in step 4 of `install.sh`.
Replace the entire conditional block with an unconditional reset:

```bash
# Always clear template development history on install
if [ -d "$CLASI_DIR" ]; then
  rm -rf "$CLASI_DIR/sprints/done"/*
  rm -rf "$CLASI_DIR/todo/done"/*
  rm -rf "$CLASI_DIR/todo/for-later"/*
  rm -f  "$CLASI_DIR/todo"/*.md
  rm -rf "$CLASI_DIR/reflections"/*
  rm -rf "$CLASI_DIR/architecture/done"/*
  rm -f  .clasi.db
fi
rm -f .template
success "CLASI reset — ready for your project"
```

### 3. `README.md` — clarify which script to use

Update the **Getting Started** section to explain the two paths:

- **New project** (clone and start building): use `./scripts/install.sh`
- **Template development** (contributing to the template): use
  `./scripts/dev.sh` — performs the same setup but leaves CLASI intact
