#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Terminal colors and helpers
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold)
  DIM=$(tput dim)
  RESET=$(tput sgr0)
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)
  CYAN=$(tput setaf 6)
else
  BOLD="" DIM="" RESET="" RED="" GREEN="" YELLOW="" BLUE="" CYAN=""
fi


header() {
  echo ""
  echo "${BLUE}${BOLD}$1${RESET}"
  echo "${BLUE}$(printf '%.0s─' $(seq 1 ${#1}))${RESET}"
}

info()    { echo "  ${GREEN}$1${RESET}"; }
detail()  { echo "  ${DIM}$1${RESET}"; }
warn()    { echo "  ${YELLOW}WARNING:${RESET} $1"; }
err()     { echo "  ${RED}ERROR:${RESET} $1"; }
success() { echo "  ${GREEN}✓${RESET} $1"; }
bullet()  { echo "  ${CYAN}•${RESET} $1"; }

# ---------------------------------------------------------------------------
# 1. Install npm dependencies
# ---------------------------------------------------------------------------
header "Installing Dependencies"

echo "  ${DIM}root${RESET}"
npm install --silent

echo "  ${DIM}server${RESET}"
npm install --silent --prefix server

echo "  ${DIM}client${RESET}"
npm install --silent --prefix client

success "All dependencies installed"

# ---------------------------------------------------------------------------
# 2. Check for Docker and detect contexts
# ---------------------------------------------------------------------------
header "Docker"

DEV_CONTEXT="default"
PROD_CONTEXT="swarm1"

if ! command -v docker &>/dev/null; then
  info "Docker is not installed (optional — SQLite mode works without it)"
  detail "To use PostgreSQL later, install Docker Desktop or OrbStack:"
  detail "  https://docs.docker.com/get-docker/"
else
  available_contexts=$(docker context ls --format '{{.Name}}' 2>/dev/null || true)

  for candidate in orbstack desktop-linux; do
    if echo "$available_contexts" | grep -qx "$candidate"; then
      DEV_CONTEXT="$candidate"
      break
    fi
  done
  success "Dev context: ${BOLD}$DEV_CONTEXT${RESET}"

  if echo "$available_contexts" | grep -qx "swarm1"; then
    PROD_CONTEXT="swarm1"
    success "Prod context: ${BOLD}$PROD_CONTEXT${RESET}"
  else
    detail "No ${BOLD}swarm1${RESET} context found (needed for production deployment only)"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Check for age and SOPS (needed by dotconfig for secrets)
# ---------------------------------------------------------------------------
header "Encryption Tools"

MISSING_TOOLS=()

if command -v age &>/dev/null; then
  success "age installed"
else
  MISSING_TOOLS+=("age")
fi

if command -v sops &>/dev/null; then
  success "sops installed"
else
  MISSING_TOOLS+=("sops")
fi

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  warn "Missing: ${MISSING_TOOLS[*]}"
  detail "These are needed by dotconfig for secrets encryption."
  echo ""
  bullet "macOS:   ${CYAN}brew install ${MISSING_TOOLS[*]}${RESET}"
  bullet "Linux:   See https://github.com/FiloSottile/age and https://github.com/getsops/sops"
  echo ""
  detail "Secrets will be unavailable until these are installed."
fi

# ---------------------------------------------------------------------------
# 4. Python Tools (CLASI, dotconfig, rundbat)
# ---------------------------------------------------------------------------
header "Python Tools"

# Helper: install or upgrade a pipx package
# Usage: pipx_install <command> <package_or_url> <display_name>
pipx_install() {
  local cmd="$1" pkg="$2" name="$3"
  if command -v "$cmd" &>/dev/null; then
    success "$name already installed"
  else
    info "Installing $name via pipx..."
    if pipx install "$pkg" 2>/dev/null; then
      success "$name installed"
    else
      if pipx upgrade "$pkg" 2>/dev/null; then
        success "$name upgraded"
      else
        err "Failed to install $name"
        detail "Try manually: pipx install $pkg"
      fi
    fi
  fi
}

if ! command -v pipx &>/dev/null; then
  warn "${BOLD}pipx${RESET} is not installed"
  detail "Python tools require pipx. Install it first:"
  echo ""
  bullet "macOS:   ${CYAN}brew install pipx && pipx ensurepath${RESET}"
  bullet "Linux:   ${CYAN}python3 -m pip install --user pipx && pipx ensurepath${RESET}"
  bullet "Windows: ${CYAN}pip install pipx && pipx ensurepath${RESET}"
  echo ""
  detail "Then re-run this script."
else
  pipx_install clasi     "git+https://github.com/ericbusboom/claude-agent-skills.git" "CLASI"
  pipx_install dotconfig "git+https://github.com/ericbusboom/dotconfig.git"           "dotconfig"
  pipx_install rundbat   "git+https://github.com/ericbusboom/rundbat.git"             "rundbat"
fi

# Run dotconfig init to set up age key and SOPS config
if command -v dotconfig &>/dev/null; then
  info "Initializing dotconfig..."
  if dotconfig init 2>/dev/null; then
    success "dotconfig initialized"
  else
    warn "dotconfig init returned an error — you may need to run it manually"
  fi
fi

# Run rundbat init to set up database configuration
if command -v rundbat &>/dev/null; then
  info "Initializing rundbat..."
  if rundbat init 2>/dev/null; then
    success "rundbat initialized"
  else
    warn "rundbat init returned an error — you may need to run it manually"
  fi
fi

# Wipe template SE history immediately before re-initialising CLASI.
# install-dev.sh sets PRESERVE_CLASI=1 so template contributors keep
# their sprint artifacts intact.
CLASI_DIR="docs/clasi"
if [ "${PRESERVE_CLASI:-0}" = "1" ]; then
  info "CLASI retained (install-dev mode)"
else
  info "Clearing template development history..."
  if [ -d "$CLASI_DIR" ]; then
    rm -rf "$CLASI_DIR/sprints/done"/*        2>/dev/null || true
    rm -rf "$CLASI_DIR/todo/done"/*            2>/dev/null || true
    rm -rf "$CLASI_DIR/todo/for-later"/*       2>/dev/null || true
    rm -f  "$CLASI_DIR/todo"/*.md              2>/dev/null || true
    rm -rf "$CLASI_DIR/reflections"/*          2>/dev/null || true
    rm -rf "$CLASI_DIR/architecture/done"/*    2>/dev/null || true
    rm -f  "$CLASI_DIR/.clasi.db"              2>/dev/null || true
  fi
  rm -f .template
  success "CLASI reset — ready for your project"
fi

# Run clasi init to create a fresh project database
if command -v clasi &>/dev/null; then
  info "Initializing CLASI project..."
  if clasi init 2>/dev/null; then
    success "CLASI initialized"
  else
    warn "clasi init returned an error — you may need to run it manually"
  fi
fi



# ---------------------------------------------------------------------------
# 5. Generate .env
# ---------------------------------------------------------------------------
header "Environment File"

if [ -f .env ]; then
  if [ -t 0 ]; then
    # Interactive — ask the user
    warn ".env already exists"
    echo ""
    echo "  ${CYAN}1${RESET}) Overwrite with fresh .env"
    echo "  ${CYAN}2${RESET}) Keep existing .env"
    echo ""

    while true; do
      read -rp "  ${BOLD}Choose [1/2]:${RESET} " env_choice
      case "$env_choice" in
        1)
          info "Overwriting .env..."
          rm -f .env
          break
          ;;
        2)
          success "Keeping existing .env"
          echo ""
          echo "${GREEN}${BOLD}Setup complete.${RESET}"
          exit 0
          ;;
        *)
          err "Please enter 1 or 2."
          ;;
      esac
    done
  else
    # Non-interactive (Codespaces, CI) — overwrite silently
    info "Overwriting .env (non-interactive)..."
    rm -f .env
  fi
fi

info "Generating .env..."

# Assemble .env from config layers
{
  echo "# --- public (dev) ---"
  cat config/dev/public.env
  echo ""
  echo "# --- public-local ---"
  echo "DEV_DOCKER_CONTEXT=$DEV_CONTEXT"
  echo "PROD_DOCKER_CONTEXT=$PROD_CONTEXT"
} > .env

# Append secrets if dotconfig is available
if command -v dotconfig &>/dev/null; then
  info "Loading secrets via dotconfig..."
  if dotconfig env dev >> .env 2>/dev/null; then
    success "Secrets appended to .env"
  else
    warn "dotconfig failed — add secrets manually to .env"
    detail "See config/dev/secrets.env.example for required variables"
  fi
else
  echo ""
  echo "# --- secrets (add manually or install dotconfig) ---" >> .env
  if [ -f config/dev/secrets.env.example ]; then
    cat config/dev/secrets.env.example >> .env
  fi
  warn "dotconfig not installed — secrets placeholders added to .env"
  detail "Install dotconfig or add secrets manually"
fi

success "Created .env"

# ---------------------------------------------------------------------------
# Commit setup changes so the user starts with a clean working tree
# ---------------------------------------------------------------------------
header "Committing Setup Changes"

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  git add -A
  git commit -m "initial configuration" --quiet
  success "Committed setup changes"
else
  success "Nothing to commit — working tree already clean"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "${GREEN}${BOLD}┌──────────────────────────────────────┐${RESET}"
echo "${GREEN}${BOLD}│          Setup complete!             │${RESET}"
echo "${GREEN}${BOLD}└──────────────────────────────────────┘${RESET}"
echo ""
echo "  Next step: ${CYAN}npm run dev${RESET}"
echo ""
                                