import { createFileRoute } from '@tanstack/react-router'
import { CONVEX_AUDIENCE, authBaseUrl } from '#/lib/auth'

/**
 * Minimal OIDC discovery document.
 *
 * Convex's custom-auth integration starts here to find the JWKS for the
 * issuer named in `convex/auth.config.ts`. Better Auth's jwt plugin serves
 * the keys themselves at `/api/auth/jwks` but does not publish a discovery
 * document, so this route is the one link between them.
 */
export const Route = createFileRoute('/.well-known/openid-configuration')({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            issuer: authBaseUrl,
            jwks_uri: `${authBaseUrl}/api/auth/jwks`,
            authorization_endpoint: `${authBaseUrl}/signin`,
            response_types_supported: ['id_token'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'email', 'name'],
            audience: CONVEX_AUDIENCE,
          },
          { headers: { 'cache-control': 'public, max-age=3600' } },
        ),
    },
  },
})
