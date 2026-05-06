#!/usr/bin/env bash
# Boot the app stack: redis container → web → worker.
# Idempotent: safe to run multiple times. Existing app processes are stopped
# and restarted so configuration changes are always picked up. Docker containers
# are left alone unless --restart-docker is passed.
#
# Usage:
#   bash scripts/start.sh
#   bash scripts/start.sh --restart-docker     # also bounce redis
#   bash scripts/start.sh --skip-build         # don't run pnpm build (assume .next exists)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$PROJECT_ROOT"

# ───── flags ──────────────────────────────────────────────────────────────────
RESTART_DOCKER=0
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --restart-docker) RESTART_DOCKER=1 ;;
    --skip-build)     SKIP_BUILD=1 ;;
    -h|--help)
      cat <<EOF >&2
Usage: bash scripts/start.sh [--restart-docker] [--skip-build]

  --restart-docker    Restart redis container (default: leave running)
  --skip-build        Skip the production build step (default: build if .next missing)

EOF
      exit 0
      ;;
    *)
      fail "Unknown flag: $arg"
      exit 2
      ;;
  esac
done

trap 'echo; fail "Aborted"; exit 130' INT TERM

# 1. Pre-flight checks
banner "1/5  Pre-flight checks"

PREFLIGHT_FAIL=0
require_command node    "Install with: brew install node@20"             || PREFLIGHT_FAIL=1
require_command pnpm    "Run: corepack enable && corepack prepare pnpm@latest --activate" || PREFLIGHT_FAIL=1
require_command docker  "Install Docker Desktop"                          || PREFLIGHT_FAIL=1
require_command ffmpeg  "Run: brew install ffmpeg"                        || PREFLIGHT_FAIL=1
require_command ffprobe "Comes with ffmpeg: brew install ffmpeg"          || PREFLIGHT_FAIL=1
require_command lsof    "lsof is part of macOS by default"                || PREFLIGHT_FAIL=1

[ "$PREFLIGHT_FAIL" = 0 ] || die "Install missing tools above and rerun."

if [ ! -f "$PROJECT_ROOT/.env.local" ]; then
  die ".env.local missing. Copy .env.example to .env.local and fill in your credentials."
fi

if [ -z "$(env_get KLING_ACCESS_KEY)" ] || [ -z "$(env_get KLING_SECRET_KEY)" ]; then
  fail "KLING_ACCESS_KEY / KLING_SECRET_KEY are not set in .env.local"
  exit 1
fi
if [ -z "$(env_get MONGODB_URI)" ]; then
  fail "MONGODB_URI is not set in .env.local"
  exit 1
fi
if [ -z "$(env_get S3_BUCKET)" ] || [ -z "$(env_get S3_ACCESS_KEY_ID)" ]; then
  fail "S3_BUCKET / S3_ACCESS_KEY_ID are not set in .env.local"
  exit 1
fi
ok "Required env vars present"

# 2. Docker daemon
banner "2/5  Docker daemon"

if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon not running — opening Docker Desktop"
  open -a Docker 2>/dev/null || true
  info "Waiting for Docker daemon (up to 90s)..."
  if ! wait_for "Docker daemon" "docker info >/dev/null 2>&1" 90; then
    die "Docker did not start. Open Docker Desktop manually and rerun."
  fi
fi
ok "Docker daemon ready"

# 3. Stop any prior app processes
banner "3/5  Stopping any prior app processes"

stop_tracked web
stop_tracked worker
stop_pattern "Next.js server" "node.*next.*(start|dev)$"
stop_pattern "BullMQ worker" "tsx.*src/worker/index.ts"

if free_port 3000; then
  log "Port 3000 freed"
fi

ok "App processes cleared"

# 4. Containers (redis only)
banner "4/5  Docker containers"

if [ "$RESTART_DOCKER" = 1 ]; then
  info "Restarting containers"
  docker compose -f docker-compose.dev.yml down 2>&1 | sed 's/^/    /' || true
fi

info "Bringing up containers"
docker compose -f docker-compose.dev.yml up -d 2>&1 | sed 's/^/    /' \
  || die "docker compose up failed"

info "Waiting for redis to be healthy (up to 30s)"
container_health_ok() {
  local statuses
  statuses=$(docker ps --filter "name=kling-mc-" --format "{{.Names}} {{.Status}}")
  [ -n "$statuses" ] || return 1
  ! echo "$statuses" | grep -vqE "\(healthy\)" || return 1
  return 0
}
if ! wait_for "container health" container_health_ok 30; then
  warn "Redis not healthy. Last logs:"
  docker compose -f docker-compose.dev.yml logs --tail=20 2>&1 | sed 's/^/    /'
  die "Redis did not become healthy"
fi
ok "Redis healthy"

# 5. Production build + start web/worker
banner "5/5  Build and start web + worker"

if [ "$SKIP_BUILD" = 1 ]; then
  log "--skip-build set, not building"
elif [ ! -f "$PROJECT_ROOT/.next/BUILD_ID" ]; then
  info "Building (one-time)"
  pnpm build 2>&1 | tail -20 | sed 's/^/    /' || die "pnpm build failed"
  ok "Build complete"
else
  log "Reusing existing build (delete .next/ to force rebuild)"
fi

start_web() {
  local log_file
  log_file=$(log_file_for web)
  : > "$log_file"
  info "Starting Next.js (production mode) → $log_file"
  ( cd "$PROJECT_ROOT" && nohup pnpm start >"$log_file" 2>&1 ) &
  local wrapper_pid=$!

  info "Waiting for web server on http://localhost:3000 (up to 60s)..."
  if ! wait_for "web server" \
        "curl -s -o /dev/null --max-time 2 http://localhost:3000/api/usage" 60; then
    tail -20 "$log_file" >&2
    die "Web server did not respond"
  fi

  local real_pid
  real_pid=$(lsof -ti tcp:3000 2>/dev/null | head -1 || true)
  [ -z "$real_pid" ] && real_pid=$wrapper_pid
  echo "$real_pid" > "$(pid_file_for web)"
  log "web PID: $real_pid"
}

start_worker() {
  local log_file
  log_file=$(log_file_for worker)
  : > "$log_file"
  info "Starting BullMQ worker → $log_file"
  ( cd "$PROJECT_ROOT" && nohup pnpm start:worker >"$log_file" 2>&1 ) &
  local wrapper_pid=$!

  info "Waiting for worker boot (up to 30s)..."
  local deadline=$(( $(date +%s) + 30 ))
  while true; do
    if grep -q "Starting Kling workers" "$log_file" 2>/dev/null; then
      break
    fi
    if grep -qE "Worker bootstrap failed|FATAL" "$log_file" 2>/dev/null; then
      tail -20 "$log_file" >&2
      die "Worker failed to boot"
    fi
    if [ "$(date +%s)" -gt "$deadline" ]; then
      tail -20 "$log_file" >&2
      die "Worker did not boot in 30s"
    fi
    sleep 1
  done

  local real_pid
  real_pid=$(pgrep -f "tsx.*src/worker/index.ts" 2>/dev/null | tail -1 || true)
  [ -z "$real_pid" ] && real_pid=$wrapper_pid
  echo "$real_pid" > "$(pid_file_for worker)"
  log "worker PID: $real_pid"
}

start_web
ok "Web server up"

start_worker
ok "Worker up"

banner "Ready"

printf "\n"
printf "  %sApp%s         %shttp://localhost:3000%s\n" "$C_DIM" "$C_RESET" "$C_BOLD" "$C_RESET"
printf "\n"
printf "  Stop:   bash scripts/stop.sh\n"
printf "  Status: bash scripts/status.sh\n"
printf "\n"
