import { useCallback, useMemo } from 'react'
import { ConvexProviderWithAuth } from 'convex/react'
import { ConvexQueryClient } from '@convex-dev/react-query'
import { authClient } from '#/lib/auth-client'

const CONVEX_URL = (import.meta as any).env.VITE_CONVEX_URL
if (!CONVEX_URL) {
  console.error('missing envar CONVEX_URL')
}
const convexQueryClient = new ConvexQueryClient(CONVEX_URL)

/**
 * Bridges the Better Auth session to Convex.
 *
 * Convex never sees this app's session cookie. It gets a short-lived RS256
 * JWT minted by the Better Auth `jwt` plugin, verifies it against the
 * published JWKS, and exposes the user id to every function as
 * `ctx.auth.getUserIdentity().subject`. That is what makes the identity
 * unspoofable — before this, functions took the user id as an argument and
 * believed whatever the client sent.
 */
function useBetterAuthForConvex() {
  const { data: session, isPending } = authClient.useSession()

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        const response = await fetch('/api/auth/token', {
          credentials: 'include',
          // A forced refresh means the previous token was rejected or is
          // about to expire; skip any intermediary cache for that one.
          cache: forceRefreshToken ? 'no-store' : 'default',
        })
        if (!response.ok) return null
        const body = (await response.json()) as { token?: string }
        return body.token ?? null
      } catch {
        // Offline or mid-deploy: Convex retries, and the board stays on its
        // last good data rather than flipping to a signed-out shell.
        return null
      }
    },
    [],
  )

  return useMemo(
    () => ({
      isLoading: isPending,
      isAuthenticated: Boolean(session?.user),
      fetchAccessToken,
    }),
    [isPending, session?.user, fetchAccessToken],
  )
}

export default function AppConvexProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexProviderWithAuth
      client={convexQueryClient.convexClient}
      // ConvexProviderWithAuth's public API requires a hook reference here; it calls useAuth() internally.
      // react-doctor-disable-next-line react-hooks-js/hooks
      useAuth={useBetterAuthForConvex}
    >
      {children}
    </ConvexProviderWithAuth>
  )
}
