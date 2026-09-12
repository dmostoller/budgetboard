import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { jwt } from 'better-auth/plugins/jwt'
import { Pool } from 'pg'

/**
 * Public origin of this app. It is the JWT issuer, so it has to match the
 * `domain` in `convex/auth.config.ts` exactly — Convex fetches
 * `${domain}/.well-known/openid-configuration` to discover the signing keys
 * and then rejects any token whose `iss` differs.
 */
export const authBaseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'

/** The `aud` claim Convex is configured to accept. */
export const CONVEX_AUDIENCE = 'convex'

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

export const hasGoogleAuth = Boolean(googleClientId && googleClientSecret)

/**
 * Better Auth needs its own store for users, sessions and OAuth accounts —
 * Convex holds the board, not the credentials. Point `DATABASE_URL` at any
 * Postgres (Neon, Supabase, RDS…) and run `npx @better-auth/cli migrate` once
 * to create the tables.
 *
 * Without it Better Auth falls back to its in-memory adapter, which is fine
 * for a first local run but forgets every account when the server restarts.
 */
const connectionString = process.env.DATABASE_URL

if (!connectionString && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[auth] DATABASE_URL is not set — using the in-memory store. ' +
      'Accounts will disappear when the dev server restarts.',
  )
}

if (!connectionString && process.env.NODE_ENV === 'production') {
  throw new Error(
    'DATABASE_URL is required in production: Better Auth would otherwise ' +
      'keep accounts in memory and lose them on every cold start.',
  )
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  ...(connectionString ? { database: new Pool({ connectionString }) } : {}),
  emailAndPassword: {
    // Kept enabled so the app is usable before Google OAuth credentials exist.
    enabled: true,
  },
  socialProviders:
    googleClientId && googleClientSecret
      ? {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        }
      : undefined,
  plugins: [
    /**
     * Convex does not share this app's session cookie — it verifies a signed
     * JWT instead. This plugin publishes the signing keys at
     * `/api/auth/jwks` and mints a short-lived token at `/api/auth/token`,
     * which is what lets every Convex function derive the caller's identity
     * from `ctx.auth` rather than trusting a `userId` sent by the client.
     *
     * RS256 rather than the plugin's Ed25519 default: that is what Convex's
     * token verifier accepts.
     */
    jwt({
      jwks: { keyPairConfig: { alg: 'RS256' } },
      jwt: {
        issuer: authBaseUrl,
        audience: CONVEX_AUDIENCE,
        expirationTime: '1h',
        definePayload: ({ user }) => ({
          email: user.email,
          name: user.name,
        }),
      },
    }),
    tanstackStartCookies(),
  ],
})
