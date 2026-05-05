#!/usr/bin/env bash
# Common helpers for start/stop/status scripts.
# Source this from each script.

# Strict mode where useful, but allow individual scripts to relax.
set -o pipefail

# ──────────────────────────────────────────────────────────────────────────────
# Project paths

# Resolve the project root (one level up from scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$PROJECT_ROOT/.run"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$RUN_DIR" "$LOG_DIR"

# ──────────────────────────────────────────────────────────────────────────────
# Colours (gracefully degrade if not a TTY)

if [ -t 2 ] && [ "${NO_COLOR:-}" != "1" ]; then
  C_RESET=$'\033[0m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_MAGENTA=$'\033[35m'
  C_CYAN=$'\033[36m'
else
  C_RESET=""
  C_DIM=""
  C_BOLD=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
  C_MAGENTA=""
  C_CYAN=""
fi

# ──────────────────────────────────────────────────────────────────────────────
# Logging

log()    { printf "  %s%s%s\n" "$C_DIM" "$*" "$C_RESET" >&2; }
info()   { printf "%s→%s %s\n" "$C_BLUE" "$C_RESET" "$*" >&2; }
ok()     { printf "%s✓%s %s\n" "$C_GREEN" "$C_RESET" "$*" >&2; }
warn()   { printf "%s⚠%s %s\n" "$C_YELLOW" "$C_RESET" "$*" >&2; }
fail()   { printf "%s✗%s %s\n" "$C_RED"   "$C_RESET" "$*" >&2; }
banner() { printf "\n%s%s%s\n" "$C_BOLD$C_CYAN" "$*" "$C_RESET" >&2; }
die()    { fail "$*"; exit 1; }

# ──────────────────────────────────────────────────────────────────────────────
# Tool / dependency checks

require_command() {
  local cmd="$1" hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail "$cmd is not installed."
    log  "$hint"
    return 1
  fi
  return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# PID handling

pid_file_for() { printf "%s/%s.pid" "$RUN_DIR" "$1"; }
log_file_for() { printf "%s/%s.log" "$LOG_DIR" "$1"; }

is_running() {
  local pid_file
  pid_file=$(pid_file_for "$1")
  [ -f "$pid_file" ] || return 1
  local pid
  pid=$(cat "$pid_file" 2>/dev/null || echo "")
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local pid_file
  pid_file=$(pid_file_for "$1")
  cat "$pid_file" 2>/dev/null || echo ""
}

stop_tracked() {
  local name="$1"
  local pid_file
  pid_file=$(pid_file_for "$name")
  [ -f "$pid_file" ] || return 0

  local pid
  pid=$(cat "$pid_file" 2>/dev/null || echo "")

  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    log "$name: stale PID file (no live process)"
    rm -f "$pid_file"
    return 0
  fi

  info "Stopping $name (PID $pid)"
  kill -TERM "$pid" 2>/dev/null || true

  local deadline=$(( $(date +%s) + 8 ))
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$(date +%s)" -gt "$deadline" ]; then
      warn "$name (PID $pid) didn't exit on SIGTERM, sending SIGKILL"
      kill -KILL "$pid" 2>/dev/null || true
      break
    fi
    sleep 0.5
  done

  rm -f "$pid_file"
  ok "$name stopped"
}

# Kill anything we recognise by argv pattern, even if we don't have a PID file
# for it (e.g. processes started by a previous shell or by `pnpm dev`).
stop_pattern() {
  local label="$1" pattern="$2"
  local pids
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  [ -z "$pids" ] && return 0
  warn "Found untracked $label processes: $pids — stopping"
  pkill -TERM -f "$pattern" 2>/dev/null || true
  sleep 1
  pkill -KILL -f "$pattern" 2>/dev/null || true
}

# Kill whatever is listening on a TCP port (useful when port is occupied
# by an unrelated process). Returns 0 if killed something, 1 if port was free.
free_port() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    log "lsof not available; cannot check port $port"
    return 1
  fi
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  [ -z "$pids" ] && return 1
  warn "Port $port is held by PID(s) $pids — stopping"
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 1
  for p in $pids; do kill -KILL "$p" 2>/dev/null || true; done
  return 0
}

# ──────────────────────────────────────────────────────────────────────────────
# Wait helpers

wait_for() {
  local label="$1" probe_cmd="$2" timeout="${3:-60}"
  local deadline=$(( $(date +%s) + timeout ))
  while ! eval "$probe_cmd" >/dev/null 2>&1; do
    if [ "$(date +%s)" -gt "$deadline" ]; then
      fail "Timed out waiting for $label after ${timeout}s"
      return 1
    fi
    sleep 1
  done
}

# ──────────────────────────────────────────────────────────────────────────────
# .env.local helpers

env_get() {
  local key="$1"
  [ -f "$PROJECT_ROOT/.env.local" ] || return 0
  awk -F= -v k="^${key}=" '$0 ~ k { sub(/^[^=]*=/, ""); print; exit }' "$PROJECT_ROOT/.env.local"
}

env_set() {
  local key="$1" value="$2"
  local file="$PROJECT_ROOT/.env.local"
  [ -f "$file" ] || die ".env.local does not exist; create it from .env.example"
  if grep -qE "^${key}=" "$file"; then
    # Use a delimiter unlikely to appear in URLs/secrets
    local tmp
    tmp=$(mktemp)
    awk -v k="^${key}=" -v repl="${key}=${value}" '
      $0 ~ k { print repl; next }
      { print }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$file"
  fi
}
