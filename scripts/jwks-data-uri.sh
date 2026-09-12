#!/usr/bin/env bash
#
# Print the running app's JWKS as a `data:` URI, for Convex's `JWKS`
# environment variable.
#
# Convex needs the app's public signing keys to verify a token. In production
# it fetches them from the deployed origin; in local development it cannot
# reach localhost, so the key set is embedded in `convex/auth.config.ts`
# instead. This prints the value to embed.
#
# Usage (with the app running):
#   npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"
#
# The output is a public key set, so it is configuration rather than a secret.

set -uo pipefail

URL="${1:-http://localhost:3000}/api/auth/jwks"

jwks=$(curl -fsS -m 10 "$URL" 2>/dev/null) || {
  printf 'could not read %s — is the app running?\n' "$URL" >&2
  exit 1
}

case "$jwks" in
  *'"keys"'*) ;;
  *)
    printf 'unexpected response from %s:\n%s\n' "$URL" "$jwks" >&2
    exit 1
    ;;
esac

printf 'data:text/plain;charset=utf-8;base64,%s' "$(printf '%s' "$jwks" | base64 | tr -d '\n')"
