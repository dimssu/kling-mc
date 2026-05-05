#!/usr/bin/env bash
# Show the state of every piece of the stack.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

cd "$PROJECT_ROOT"

# Docker
banner "Docker containers"
if docker info >/dev/null 2>&1; then
  docker ps --filter "name=kling-mc-" --format "  {{.Names}}  {{.Status}}" 2>&1 \
    | sort \
    | sed -e "s|healthy|${C_GREEN}healthy${C_RESET}|" \
          -e "s|unhealthy|${C_RED}unhealthy${C_RESET}|" \
          -e "s|starting|${C_YELLOW}starting${C_RESET}|" \
    || warn "no containers running"
else
  warn "Docker daemon not running"
fi

# Application processes
banner "App processes"
report() {
  local name="$1"
  local pid
  pid=$(read_pid "$name")
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    printf "  %s%-9s%s  %sstopped%s\n" "$C_DIM" "$name" "$C_RESET" "$C_DIM" "$C_RESET"
    return
  fi
  # rss in KB on macOS, etime is hh:mm:ss / mm:ss / d-hh:mm:ss
  local rss etime
  read -r rss etime < <(ps -o rss=,etime= -p "$pid" 2>/dev/null | awk '{print $1, $2}')
  local rss_mb="?"
  if [ -n "${rss:-}" ]; then rss_mb=$(awk -v r="$rss" 'BEGIN { printf "%.0f", r/1024 }'); fi
  printf "  %s%-9s%s  %srunning%s  PID %-6s  RSS %s MB  up %s\n" \
    "" "$name" "" "$C_GREEN" "$C_RESET" "$pid" "$rss_mb" "${etime:-?}"
}
report web
report worker
report tunnel

# Tunnel URL
banner "Tunnel URL"
TUNNEL_URL=""
if [ -f "$(log_file_for tunnel)" ]; then
  TUNNEL_URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$(log_file_for tunnel)" 2>/dev/null | head -1 || true)
fi
ENV_URL=$(env_get S3_PUBLIC_ENDPOINT)

if [ -n "$TUNNEL_URL" ]; then
  printf "  Live tunnel       %s\n" "$TUNNEL_URL"
fi
if [ -n "$ENV_URL" ]; then
  printf "  In .env.local     %s\n" "$ENV_URL"
fi
if [ -n "$TUNNEL_URL" ] && [ -n "$ENV_URL" ] && [ "$TUNNEL_URL" != "$ENV_URL" ]; then
  warn "Live tunnel URL doesn't match .env.local — restart the worker (bash scripts/start.sh)"
fi
[ -z "$TUNNEL_URL" ] && [ -z "$ENV_URL" ] && log "no tunnel URL recorded"

# HTTP probes
banner "HTTP probes"
probe() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null) || code=""
  [ -z "$code" ] && code="000"
  if [ "$code" = "200" ] || [ "$code" = "301" ] || [ "$code" = "302" ]; then
    printf "  %-30s %s%s%s\n" "$label" "$C_GREEN" "$code" "$C_RESET"
  else
    printf "  %-30s %s%s%s\n" "$label" "$C_RED" "$code" "$C_RESET"
  fi
}
probe "http://localhost:3000/"           "http://localhost:3000/"
probe ".../api/usage"                    "http://localhost:3000/api/usage"
# We don't probe a tunnel-side URL — there's no cheap probe that doesn't
# require an existing storage key, and 4xx/200 both mean "tunnel is up".

# Recent log tails for anything not running cleanly
banner "Recent log activity (last 3 lines each)"
for n in web worker tunnel; do
  local_file=$(log_file_for "$n")
  if [ -f "$local_file" ]; then
    printf "\n  %s%s%s\n" "$C_DIM" "$local_file" "$C_RESET"
    tail -3 "$local_file" 2>/dev/null | sed 's/^/    /'
  fi
done

printf "\n"
