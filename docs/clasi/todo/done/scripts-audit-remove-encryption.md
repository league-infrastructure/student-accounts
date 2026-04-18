---
title: 'Audit Scripts: Remove Obsolete Encryption Scripts'
type: todo
priority: medium
status: done
sprint: '016'
tickets:
- '001'
---

# Audit Scripts: Remove Obsolete Encryption Scripts

## Problem

The project moved from SOPS/age encryption to a `config/` directory approach, but several scripts and package.json entries still reference the old encryption workflow.

## Scripts to Review

| Script | Purpose | Action |
|--------|---------|--------|
| `scripts/add-age-key.sh` | Add age key for SOPS encryption | Likely remove |
| `scripts/encrypt-secrets.sh` | Encrypt secrets with SOPS | Likely remove |
| `scripts/load-secrets.sh` | Load decrypted secrets | Review — may still be needed for config |
| `scripts/deploy.sh` | Deploy to production | Review for encryption references |
| `scripts/install.sh` | Setup script | Remove/simplify SOPS/age sections (steps 3-5) |
| `scripts/version.sh` | Version management | Probably fine, review |

## package.json

- `"secrets:add-key": "./scripts/add-age-key.sh"` — remove this script entry

## What Needs to Happen

1. Identify which scripts are fully obsolete vs. which need updating
2. Remove obsolete scripts and their package.json entries
3. Update `install.sh` to remove SOPS/age setup sections (steps 3, 4, 5) since we use `config/` now
4. Update the .env generation step in `install.sh` to work with the config directory approach instead of SOPS decryption
5. Verify `deploy.sh` doesn't rely on encryption
