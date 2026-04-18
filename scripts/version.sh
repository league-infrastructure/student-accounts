#!/bin/bash
# Date-based version calculator: 0.YYYYMMDD.N
# Reads existing git tags to determine the next sequence number.

set -euo pipefail

TODAY=$(date +%Y%m%d)
LATEST=$(git tag --list "v0.${TODAY}.*" --sort=-version:refname 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  SEQ=1
else
  SEQ=$(echo "$LATEST" | sed 's/.*\.//')
  SEQ=$((SEQ + 1))
fi

VERSION="0.${TODAY}.${SEQ}"
echo "$VERSION"
