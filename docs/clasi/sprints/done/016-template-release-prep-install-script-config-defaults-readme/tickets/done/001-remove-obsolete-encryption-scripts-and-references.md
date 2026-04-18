---
id: '001'
title: Remove obsolete encryption scripts and references
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: scripts-audit-remove-encryption
---

# Remove obsolete encryption scripts and references

## Description

The project moved to dotconfig for secrets management. Several scripts and package.json entries still reference the old SOPS/age encryption workflow. Remove them.

## Acceptance Criteria

- [x] `scripts/add-age-key.sh` deleted
- [x] `scripts/encrypt-secrets.sh` deleted
- [x] `scripts/load-secrets.sh` reviewed and deleted if unused
- [x] `package.json` `secrets:add-key` script entry removed
- [x] No remaining references to deleted scripts

## Testing

- **Verification**: `grep -r 'add-age-key\|encrypt-secrets\|load-secrets\|secrets:add-key' --include='*.json' --include='*.sh' --include='*.md' .` returns no hits (outside docs/clasi)
