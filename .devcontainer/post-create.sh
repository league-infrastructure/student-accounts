#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Codespaces-only: write age key from GitHub Codespaces secret
# ---------------------------------------------------------------------------
if [ -n "${AGE_PRIVATE_KEY:-}" ]; then
	mkdir -p ~/.config/sops/age
	printf '%s\n' "$AGE_PRIVATE_KEY" > ~/.config/sops/age/keys.txt
	chmod 600 ~/.config/sops/age/keys.txt
	echo "Age key installed from AGE_PRIVATE_KEY secret"
else
	echo "AGE_PRIVATE_KEY not set — see docs/secrets.md for Codespaces key setup"
fi

# ---------------------------------------------------------------------------
# Codespaces-only: two-line prompt (better for narrow terminals)
# ---------------------------------------------------------------------------
grep -q 'PS1=.*\\n\$ ' ~/.bashrc || echo 'PS1="${PS1%\\\$ }\n$ "' >> ~/.bashrc

# ---------------------------------------------------------------------------
# Common setup (npm deps, Python tools, .env, etc.)
# ---------------------------------------------------------------------------
./scripts/install.sh
