#!/usr/bin/env bash
#
# Start everything needed to develop Budget Board locally:
#
#   convex dev   pushes convex/ to the dev deployment, re-pushes on change, and
#                tails function logs (where server-side errors, auth failures
#                included, actually show up)
#   vp dev       the app on http://localhost:3000
#
# Both run in this one terminal with prefixed output; Ctrl-C stops both.
# Postgres lives at DATABASE_URL (Neon), so there is nothing local to boot.
#
# Usage:
#   ./dev.sh                 check, then start both
#   ./dev.sh --check         run the preflight checks and exit
#   ./dev.sh --skip-checks   start immediately (skips the Convex network check)
#
# Written for bash 3.2, which is what macOS ships.

set -uo pipefail
cd "$(dirname "$0")" || exit 1

BLUE=$'\033[34m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
DIM=$'\033[2m'
RESET=$'\033[0m'

CHECK_ONLY=false
SKIP_CHECKS=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    -h | --help)
      sed -n '2,19p' "$0" | sed 's/^#\{1,2\} \{0,1\}//'
      exit 0
      ;;
    *)
      printf '%sunknown option: %s%s\n' "$RED" "$arg" "$RESET" >&2
      exit 2
      ;;
  esac
done

fail() {
  printf '%s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
  exit 1
}
warn() { printf '%s! %s%s\n' "$YELLOW" "$1" "$RESET" >&2; }
ok() { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
note() { printf '%s  %s%s\n' "$DIM" "$1" "$RESET"; }

# --- preflight -------------------------------------------------------------

[ -f .env.local ] || fail '.env.local is missing. Copy .env.example and fill it in.'
[ -d node_modules ] || fail 'node_modules is missing. Run `vp install` first.'

# Read .env.local for the checks below rather than exporting it into the
# servers' environment — Vite and Convex each load it themselves, and shadowing
# that would be one more thing to keep in sync.
env_value() {
  grep -E "^[[:space:]]*$1=" .env.local 2>/dev/null |
    tail -1 |
    sed -E "s/^[[:space:]]*$1=//" |
    sed -E 's/[[:space:]]+#.*$//' |
    sed -E 's/^"(.*)"$/\1/' |
    sed -E "s/^'(.*)'$/\1/" |
    tr -d '\r'
}

missing=''
for var in CONVEX_DEPLOYMENT VITE_CONVEX_URL BETTER_AUTH_URL BETTER_AUTH_SECRET; do
  if [ -z "$(env_value "$var")" ]; then
    missing="$missing $var"
  fi
done
[ -z "$missing" ] || fail "missing in .env.local:$missing"
ok 'env vars present'

[ -n "$(env_value DATABASE_URL)" ] ||
  warn 'DATABASE_URL is unset — Better Auth falls back to an in-memory store and forgets accounts on restart.'
[ -n "$(env_value GEMINI_API_KEY)" ] ||
  warn 'GEMINI_API_KEY is unset — the assistant will return a 500.'

APP_URL="$(env_value BETTER_AUTH_URL)"
APP_PORT="${APP_URL##*:}"
APP_PORT="${APP_PORT%%/*}"
case "$APP_PORT" in
  '' | *[!0-9]*) APP_PORT=3000 ;;
esac

if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  holder=$(lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN -Fc 2>/dev/null | grep '^c' | head -1 | cut -c2-)
  # Only fatal when actually starting: --check is worth running against a
  # stack that is already up.
  if [ "$CHECK_ONLY" = true ]; then
    note "port $APP_PORT is in use by ${holder:-another process} (already running?)"
  else
    fail "port $APP_PORT is in use by ${holder:-another process}. Stop it first — BETTER_AUTH_URL pins this port, so the app cannot just move."
  fi
else
  ok "port $APP_PORT is free"
fi

# Convex verifies the JWT this app mints, and discovers the signing keys by
# fetching ${SITE_URL}/.well-known/openid-configuration. Two ways that breaks,
# and both look identical from the browser — "Not signed in" on every query —
# so they are worth catching here rather than in a stack trace.
if [ "$SKIP_CHECKS" = false ]; then
  site_url=$(npx convex env get SITE_URL 2>/dev/null | tr -d '\r' | tail -1)
  deployment="$(env_value CONVEX_DEPLOYMENT)"

  if [ -z "$site_url" ]; then
    warn 'SITE_URL is not set on the Convex deployment — every query will fail with "Not signed in".'
    note "fix: npx convex env set SITE_URL $APP_URL"
  elif [ "$site_url" != "$APP_URL" ]; then
    warn "Convex SITE_URL ($site_url) does not match BETTER_AUTH_URL ($APP_URL)."
    note "It is the token's iss claim, so a mismatch means Convex rejects every token."
    note "fix: npx convex env set SITE_URL $APP_URL"
  else
    ok "Convex SITE_URL matches BETTER_AUTH_URL ($site_url)"
  fi

  # A cloud deployment cannot reach SITE_URL over the public internet when that
  # URL is localhost, so it needs the key set embedded instead — see the
  # comment at the top of convex/auth.config.ts.
  convex_jwks=$(npx convex env get JWKS 2>/dev/null | tr -d '\r\n')

  case "$site_url" in
    *localhost* | *127.0.0.1*)
      case "$deployment" in
        local:*) ;;
        *)
          if [ -z "$convex_jwks" ]; then
            warn "SITE_URL is $site_url but $deployment is a cloud deployment, and JWKS is unset."
            note 'Convex cannot fetch signing keys from a localhost URL, so every'
            note 'request looks anonymous and writes fail with "Not signed in".'
            note 'fix: start the app, then'
            note '     npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"'
          else
            ok 'Convex has an embedded JWKS for local development'
          fi
          ;;
      esac
      ;;
  esac
fi

if [ "$CHECK_ONLY" = true ]; then
  exit 0
fi

# --- run -------------------------------------------------------------------

prefix() {
  tag=$1
  color=$2
  while IFS= read -r line; do
    printf '%s[%s]%s %s\n' "$color" "$tag" "$RESET" "$line"
  done
}

cleaning_up=false
cleanup() {
  # The EXIT trap fires after INT/TERM too; only tear down once.
  [ "$cleaning_up" = true ] && return 0
  cleaning_up=true
  trap - INT TERM EXIT
  printf '\n%sstopping…%s\n' "$DIM" "$RESET"
  # A negative PID signals the whole process group, which is what catches the
  # grandchildren (npx -> convex, vp -> vite) instead of orphaning them.
  kill -TERM -$$ 2>/dev/null
  wait 2>/dev/null
  return 0
}
trap cleanup INT TERM EXIT

printf '\n%sstarting convex + app — Ctrl-C stops both%s\n\n' "$DIM" "$RESET"

# The embedded key set can go stale if Better Auth rotates its signing key,
# which surfaces as an abrupt, total "Not signed in". Comparing it needs the
# app up, so it runs in the background once the server is listening rather
# than blocking startup on it.
verify_jwks_freshness() {
  [ "$SKIP_CHECKS" = false ] || return 0
  [ -n "${convex_jwks:-}" ] || return 0

  live=''
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    live=$(./scripts/jwks-data-uri.sh 2>/dev/null) && [ -n "$live" ] && break
  done
  [ -n "$live" ] || return 0

  if [ "$live" != "$convex_jwks" ]; then
    warn 'the JWKS on Convex no longer matches the app — auth will fail.'
    note 'fix: npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"'
  fi
}
verify_jwks_freshness &

# `--tail-logs always` is the reason to run Convex here rather than forget it:
# errors thrown inside convex/ only surface in the deployment's logs.
npx convex dev --tail-logs always 2>&1 | prefix convex "$BLUE" &
convex_pid=$!

pnpm run dev 2>&1 | prefix app "$GREEN" &
app_pid=$!

# bash 3.2 has no `wait -n`, so poll: the moment either half exits, fall
# through to cleanup and take the other down rather than leaving half a stack
# running and a port held.
while kill -0 "$convex_pid" 2>/dev/null && kill -0 "$app_pid" 2>/dev/null; do
  sleep 1
done

cleanup
