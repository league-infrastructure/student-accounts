---
id: '002'
title: "Update install script \u2014 CLASI reset and remove SOPS"
status: done
use-cases:
- SUC-001
depends-on:
- '001'
github-issue: ''
todo: install-script-clasi-reset
---

# Update install script — CLASI reset and remove SOPS

## Description

The install script needs two major updates:
1. Remove SOPS/age sections (steps 3, 4, 5) — encryption is handled by dotconfig
2. Add a CLASI reset step that clears template development history so students start fresh

## Acceptance Criteria

- [ ] SOPS/age check section removed from install.sh
- [ ] Age key generation/paste section removed
- [ ] SOPS configuration section removed
- [ ] Secrets decryption section removed from .env generation
- [ ] New CLASI reset step added: clears sprints/done, todo/done, reflections, architecture/done, .clasi.db
- [ ] CLASI reset preserves empty directory structure
- [ ] `clasi init` runs after reset to create fresh project
- [ ] .env generation simplified (no SOPS decryption)
- [ ] Script still installs npm deps correctly
- [ ] Script still detects Docker contexts

## Testing

- **Verification**: Read through the script, confirm no SOPS/age references remain. CLASI reset section present and correct.
