#!/usr/bin/env bash
# Boot the entire app stack: docker infra → cloudflared → web → worker.
# Idempotent: safe to run multiple times. Existing app processes are stopped
# and restarted so configuration changes (new tunnel URL, new env vars) are
# always picked up. Docker containers are left alone unless --restart-docker
# is passed, since restarting them is slow and rarely needed.
#
# Usage:
#   bash scripts/start.sh
#   bash scripts/start.sh --restart-docker     # also bounce postgres/redis/minio
#   bash scripts/start.sh --skip-build         # don't run pnpm build (assume .next exists)
#   bash scripts/start.sh --reuse-tunnel       # don't restart cloudflared if running
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$PROJECT_ROOT"

# ───── flags ──────────────────────────────────────────────────────────────────
RESTART_DOCKER=0
SKIP_BUILD=0
REUSE_TUNNEL=0

for arg in "$@"; do
  case "$arg" in
    --restart-docker) RESTART_DOCKER=1 ;;
    --skip-build)     SKIP_BUILD=1 ;;
    --reuse-tunnel)   REUSE_TUNNEL=1 ;;
    -h|--help)
      cat <<EOF >&2
Usage: bash scripts/start.sh [--restart-docker] [--skip-build] [--reuse-tunnel]

  --restart-docker    Restart postgres/redis/minio containers (default: leave running)
  --skip-build        Skip the production build step (default: build if .next missing)
  --reuse-tunnel      Don't restart cloudflared if it's already up (keeps the same URL)

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

# ──────────────────────────────────────────────────────────────────────────────
# 1. Pre-flight checks
banner "1/8  Pre-flight checks"

PREFLIGHT_FAIL=0
require_command node       "Install with: brew install node@20"             || PREFLIGHT_FAIL=1
require_command pnpm       "Run: corepack enable && corepack prepare pnpm@latest --activate" || PREFLIGHT_FAIL=1
require_command docker     "Install Docker Desktop"                          || PREFLIGHT_FAIL=1
require_command ffmpeg     "Run: brew install ffmpeg"                        || PREFLIGHT_FAIL=1
require_command ffprobe    "Comes with ffmpeg: brew install ffmpeg"          || PREFLIGHT_FAIL=1
require_command cloudflared "Run: brew install cloudflared"                  || PREFLIGHT_FAIL=1
require_command lsof       "lsof is part of macOS by default"                || PREFLIGHT_FAIL=1

[ "$PREFLIGHT_FAIL" = 0 ] || die "Install missing tools above and rerun."

if [ ! -f "$PROJECT_ROOT/.env.local" ]; then
  die ".env.local missing. Copy .env.example to .env.local and fill in your Kling credentials."
fi

if [ -z "$(env_get KLING_ACCESS_KEY)" ] || [ -z "$(env_get KLING_SECRET_KEY)" ]; then
  fail "KLING_ACCESS_KEY / KLING_SECRET_KEY are not set in .env.local"
  log  "Get them at https://app.klingai.com/global/dev → API Keys, then paste into .env.local."
  exit 1
fi
ok "Kling credentials present in .env.local"

ok "Pre-flight: all required tools available"

# ──────────────────────────────────────────────────────────────────────────────
# 2. Docker daemon
banner "2/8  Docker daemon"

if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon not running — opening Docker Desktop"
  open -a Docker 2>/dev/null || true
  info "Waiting for Docker daemon (up to 90s)..."
  if ! wait_for "Docker daemon" "docker info >/dev/null 2>&1" 90; then
    die "Docker did not start. Open Docker Desktop manually and rerun."
  fi
fi
ok "Docker daemon ready"

# ──────────────────────────────────────────────────────────────────────────────
# 3. Stop any prior app processes (web, worker, cloudflared)
banner "3/8  Stopping any prior app processes"

# Stop tracked PIDs first
stop_tracked web
stop_tracked worker
if [ "$REUSE_TUNNEL" = 0 ]; then
  stop_tracked tunnel
fi

# Then sweep for untracked processes (e.g. a previous `pnpm dev` started
# manually, or my chat-spawned processes). Patterns are project-specific
# enough that we won't kill unrelated work.
stop_pattern "Next.js server" "node.*next.*(start|dev)$"
stop_pattern "BullMQ worker" "tsx.*src/worker/index.ts"
if [ "$REUSE_TUNNEL" = 0 ]; then
  stop_pattern "Cloudflare tunnel" "cloudflared tunnel --url http://localhost:9000"
fi

# Finally, free port 3000 if anything's still squatting on it
if free_port 3000; then
  log "Port 3000 freed"
fi

ok "App processes cleared"

# ──────────────────────────────────────────────────────────────────────────────
# 4. Containers (postgres, redis, minio)
banner "4/8  Docker containers"

if [ "$RESTART_DOCKER" = 1 ]; then
  info "Restarting containers"
  docker compose -f docker-compose.dev.yml down 2>&1 | sed 's/^/    /' || true
fi

info "Bringing up containers"
docker compose -f docker-compose.dev.yml up -d 2>&1 | sed 's/^/    /' \
  || die "docker compose up failed"

info "Waiting for postgres + redis + minio to be healthy (up to 60s)"
container_health_ok() {
  # ignore the one-shot bucket-init container
  local statuses
  statuses=$(docker ps --filter "name=kling-mc-" --format "{{.Names}} {{.Status}}" \
              | grep -v 'kling-mc-minio-init')
  [ -n "$statuses" ] || return 1
  ! echo "$statuses" | grep -vqE "\(healthy\)" || return 1
  return 0
}
if ! wait_for "container health" container_health_ok 60; then
  warn "Some containers are not healthy. Showing last logs:"
  docker compose -f docker-compose.dev.yml logs --tail=20 2>&1 | sed 's/^/    /'
  die "Containers did not become healthy"
fi
ok "Postgres, Redis, MinIO healthy"

# ──────────────────────────────────────────────────────────────────────────────
# 5. Cloudflared tunnel
banner "5/8  Cloudflare tunnel for MinIO"

start_tunnel_fresh() {
  local log_file
  log_file=$(log_file_for tunnel)
  : > "$log_file"
  nohup cloudflared tunnel --url http://localhost:9000 \
    >"$log_file" 2>&1 &
  echo $! > "$(pid_file_for tunnel)"

  info "Waiting for tunnel URL (up to 30s)..."
  local deadline=$(( $(date +%s) + 30 ))
  while true; do
    TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$log_file" 2>/dev/null | head -1 || true)
    [ -n "${TUNNEL_URL:-}" ] && break
    if [ "$(date +%s)" -gt "$deadline" ]; then
      tail -10 "$log_file" >&2 || true
      die "Cloudflared did not assign a URL in 30s"
    fi
    sleep 1
  done
}

EXISTING_TUNNEL_URL=""
if is_running tunnel; then
  EXISTING_TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$(log_file_for tunnel)" 2>/dev/null | head -1 || true)
fi

if [ "$REUSE_TUNNEL" = 1 ] && [ -n "$EXISTING_TUNNEL_URL" ]; then
  TUNNEL_URL="$EXISTING_TUNNEL_URL"
  ok "Reusing existing tunnel: $TUNNEL_URL"
else
  start_tunnel_fresh
  ok "Tunnel up: $TUNNEL_URL"
fi

# Probe that the tunnel actually serves MinIO objects (anonymous read, OK if 404
# because no object at root).
info "Verifying tunnel reaches MinIO..."
PROBE_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
  "$TUNNEL_URL/minio/health/live" 2>/dev/null || echo "000")
if [ "$PROBE_CODE" != "200" ]; then
  warn "Tunnel health check returned HTTP $PROBE_CODE — MinIO may not be ready yet."
  log  "(This is informational; the tunnel will still try to serve uploads.)"
else
  ok "Tunnel reaches MinIO (200 OK)"
fi

# Persist into .env.local so Next + worker pick it up on (re)start
env_set S3_PUBLIC_ENDPOINT "$TUNNEL_URL"
ok "S3_PUBLIC_ENDPOINT updated in .env.local"

# ──────────────────────────────────────────────────────────────────────────────
# 6. Prisma client + migrations
banner "6/8  Prisma client + database migrations"

if [ ! -d "$PROJECT_ROOT/src/generated/prisma" ]; then
  info "Generating Prisma client"
  pnpm db:generate 2>&1 | sed 's/^/    /' || die "prisma generate failed"
fi

info "Applying any pending migrations"
pnpm db:deploy 2>&1 | sed 's/^/    /' || die "prisma migrate deploy failed"
ok "Database schema up to date"

# ──────────────────────────────────────────────────────────────────────────────
# 7. Production build (if missing)
banner "7/8  Next.js production build"

if [ "$SKIP_BUILD" = 1 ]; then
  log "--skip-build set, not building"
elif [ ! -f "$PROJECT_ROOT/.next/BUILD_ID" ]; then
  info "Building (this is a one-time step; subsequent starts will reuse it)"
  pnpm build 2>&1 | tail -20 | sed 's/^/    /' \
    || die "pnpm build failed"
  ok "Build complete"
else
  log "Reusing existing build (delete .next/ to force rebuild)"
  ok "Build present"
fi

# ──────────────────────────────────────────────────────────────────────────────
# 8. Start web + worker
banner "8/8  Web server and worker"

start_web() {
  local log_file
  log_file=$(log_file_for web)
  : > "$log_file"
  info "Starting Next.js (production mode) → $log_file"
  ( cd "$PROJECT_ROOT" && nohup pnpm start >"$log_file" 2>&1 ) &
  # Wrapper PID (bash subshell → pnpm → node). We'll replace this with the
  # real next-server PID once it binds the port — that's the one we need to
  # kill at stop time, since bash subshells don't propagate SIGTERM to grand-
  # children reliably.
  local wrapper_pid=$!

  info "Waiting for web server on http://localhost:3000 (up to 60s)..."
  if ! wait_for "web server" \
        "curl -s -o /dev/null --max-time 2 http://localhost:3000/api/usage" 60; then
    tail -20 "$log_file" >&2
    die "Web server did not respond"
  fi

  local real_pid
  real_pid=$(lsof -ti tcp:3000 2>/dev/null | head -1 || true)
  if [ -z "$real_pid" ]; then
    warn "Could not resolve real web PID via lsof; falling back to wrapper $wrapper_pid"
    real_pid=$wrapper_pid
  fi
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
    if grep -q "Starting motion-control worker" "$log_file" 2>/dev/null; then
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

  # Find the actual tsx/node process for the worker. Pick the most recently
  # started one that matches our pattern (excluding the bash wrappers).
  local real_pid
  real_pid=$(pgrep -f "tsx.*src/worker/index.ts" 2>/dev/null | tail -1 || true)
  if [ -z "$real_pid" ]; then
    warn "Could not resolve real worker PID; falling back to wrapper $wrapper_pid"
    real_pid=$wrapper_pid
  fi
  echo "$real_pid" > "$(pid_file_for worker)"
  log "worker PID: $real_pid"
}

start_web
ok "Web server up"

start_worker
ok "Worker up"

# ──────────────────────────────────────────────────────────────────────────────
# Summary
banner "Ready"

printf "\n"
printf "  %sApp%s         %shttp://localhost:3000%s\n" "$C_DIM" "$C_RESET" "$C_BOLD" "$C_RESET"
printf "  %sMinIO console%s  http://localhost:9001 (minioadmin/minioadmin)\n" "$C_DIM" "$C_RESET"
printf "  %sTunnel%s        $TUNNEL_URL\n" "$C_DIM" "$C_RESET"
printf "\n"
printf "  %sLogs%s\n" "$C_DIM" "$C_RESET"
printf "    web      %s\n" "$(log_file_for web)"
printf "    worker   %s\n" "$(log_file_for worker)"
printf "    tunnel   %s\n" "$(log_file_for tunnel)"
printf "\n"
printf "  Tail everything: %stail -f %s/*.log%s\n" "$C_DIM" "$LOG_DIR" "$C_RESET"
printf "  Stop everything: %sbash scripts/stop.sh%s\n" "$C_DIM" "$C_RESET"
printf "  Status:          %sbash scripts/status.sh%s\n" "$C_DIM" "$C_RESET"
printf "\n"
