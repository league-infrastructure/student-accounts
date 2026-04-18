#!/usr/bin/env bash
# install-dev.sh — same setup as install.sh, but keep CLASI artifacts.
# Use this when developing the template itself; use install.sh when
# bootstrapping a new project from the template.
set -euo pipefail

PRESERVE_CLASI=1 exec "$(dirname "$0")/install.sh" "$@"
