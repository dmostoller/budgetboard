import type { AuthConfig } from 'convex/server'

/**
 * Tells this deployment which JWTs to trust.
 *
 * Convex verifies the token's signature, which means it needs the app's public
 * signing keys. There are two ways to give it them, and which one applies
 * depends on whether Convex can reach the app over the public internet:
 *
 * - **Production**: it can. `SITE_URL` is the deployed origin, and Convex
 *   discovers the keys itself from
 *   `${SITE_URL}/.well-known/openid-configuration`.
 *
 * - **Local development**: it cannot. `SITE_URL` is `http://localhost:3000`,
 *   and a cloud deployment resolving `localhost` gets its own container, not
 *   the developer's machine — so discovery silently yields nothing and every
 *   request looks anonymous. Setting the `JWKS` environment variable to a
 *   `data:` URI embeds the key set in the config instead, so Convex fetches
 *   nothing at all.
 *
 * `issuer` and `jwks` are independent in the `customJwt` form, which is what
 * makes this work: the token can keep claiming `iss: http://localhost:3000`
 * while the keys come from somewhere Convex can actually read.
 *
 * Set up per deployment (see `dev.sh --check`, which verifies both):
 *
 *   npx convex env set SITE_URL http://localhost:3000
 *   npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"
 *
 * The embedded value is a *public* key set — safe to store as configuration.
 * Regenerate it if Better Auth ever rotates its signing key (rotation is off
 * by default), which shows up as an abrupt return of "Not signed in".
 */

const issuer = process.env.SITE_URL!
const jwks = process.env.JWKS

export default {
  providers: [
    jwks
      ? {
          type: 'customJwt',
          applicationID: 'convex',
          issuer,
          jwks,
          algorithm: 'RS256',
        }
      : {
          domain: issuer,
          applicationID: 'convex',
        },
  ],
} satisfies AuthConfig
