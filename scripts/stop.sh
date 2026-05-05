#!/usr/bin/env bash
# Stop the app stack: web, worker, cloudflared.
# Docker containers are left running unless --with-docker is passed
# (containers are cheap to leave up and restart slowly).
#
# Usage:
#   bash scripts/stop.sh
#   bash scripts/stop.sh --with-docker     # also stop postgres/redis/minio
#   bash scripts/stop.sh --hard            # also kill anything matching our patterns
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$PROJECT_ROOT"

WITH_DOCKER=0
HARD=0

for arg in "$@"; do
  case "$arg" in
    --with-docker) WITH_DOCKER=1 ;;
    --hard)        HARD=1 ;;
    -h|--help)
      cat <<EOF >&2
Usage: bash scripts/stop.sh [--with-docker] [--hard]

  --with-docker   Also stop the postgres/redis/minio containers
  --hard          Pattern-kill any leftover Next/worker/cloudflared processes
                  (use if you started something manually and the PID files
                  don't know about it)
EOF
      exit 0
      ;;
    *)
      fail "Unknown flag: $arg"
      exit 2
      ;;
  esac
done

banner "Stopping Kling Studio"

stop_tracked worker
stop_tracked web
stop_tracked tunnel

# Always sweep for the wrapper subshells and any orphan node/tsx that the
# tracked PID didn't reach. This is cheap and catches the case where the
# tracked PID was the actual server but its bash wrapper still lingers.
info "Sweeping leftover wrappers"
stop_pattern "Next.js server" "node.*next.*(start|dev)$"
stop_pattern "BullMQ worker" "tsx.*src/worker/index.ts"
free_port 3000 >/dev/null 2>&1 || true

if [ "$HARD" = 1 ]; then
  info "Hard stop: also pattern-killing the cloudflared tunnel"
  stop_pattern "Cloudflare tunnel" "cloudflared tunnel --url http://localhost:9000"
fi

if [ "$WITH_DOCKER" = 1 ]; then
  banner "Stopping Docker containers"
  if docker info >/dev/null 2>&1; then
    docker compose -f docker-compose.dev.yml down 2>&1 | sed 's/^/    /' \
      || warn "docker compose down had issues"
    ok "Containers stopped"
  else
    warn "Docker daemon not running — skipping container stop"
  fi
fi

banner "Stopped"
printf "\n"
log "Logs are kept under $LOG_DIR for post-mortem"
log "Restart with: bash scripts/start.sh"
printf "\n"
