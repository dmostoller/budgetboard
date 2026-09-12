import { createChatHook, fetchServerSentEvents, localStoragePersistence } from '@tanstack/ai-react'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { BOARD_TOOL_DEFS } from './ai-tool-defs'
import type { ChatClientPersistence } from '@tanstack/ai-react'

const CONVEX_URL = (import.meta as any).env?.VITE_CONVEX_URL as string | undefined

/**
 * Chat persistence backed by Convex instead of the browser.
 *
 * TanStack AI's persistence contract is a three-method key/value adapter over
 * one opaque `ChatPersistedState` blob — transcript plus the resume pointer
 * for a run that was still in flight. Putting that in Convex rather than
 * `localStorage` means the conversation follows the user between devices, and
 * an approval left hanging on a laptop can be answered on a phone.
 *
 * Writes are fire-and-forget: persistence is a convenience, and a failed save
 * must never take the live conversation down with it. Falls back to
 * `localStorage` when Convex is unreachable at module load.
 */
function convexPersistence(getToken: () => Promise<string | null>): ChatClientPersistence {
  if (!CONVEX_URL) return localStoragePersistence()

  const client = new ConvexHttpClient(CONVEX_URL)
  let authed: Promise<void> | null = null

  const ensureAuth = () => {
    // One token fetch per page, refreshed only if a call comes back
    // unauthenticated — the chat client calls getItem/setItem often.
    authed ??= getToken().then((token) => {
      if (token) client.setAuth(token)
    })
    return authed
  }

  return {
    async getItem(threadId) {
      try {
        await ensureAuth()
        return (await client.query(api.chat.getThread, { threadId })) ?? null
      } catch {
        authed = null
        return null
      }
    },
    async setItem(threadId, state) {
      try {
        await ensureAuth()
        await client.mutation(api.chat.setThread, { threadId, state })
      } catch {
        authed = null
      }
    },
    async removeItem(threadId) {
      try {
        await ensureAuth()
        await client.mutation(api.chat.clearThread, { threadId })
      } catch {
        authed = null
      }
    },
  }
}

async function fetchConvexToken(): Promise<string | null> {
  try {
    const response = await fetch('/api/auth/token', { credentials: 'include' })
    if (!response.ok) return null
    const body = (await response.json()) as { token?: string }
    return body.token ?? null
  } catch {
    return null
  }
}

/**
 * One persistent thread per user: the transcript survives reloads, dropped
 * connections and a switch of device, so a half-finished "add my rent" never
 * gets lost.
 */
// The tools generic is supplied explicitly: `UseChatOptions` wraps
// `ChatClientOptions` in a `DistributedOmit`, and TypeScript cannot infer a
// type parameter back out through a mapped type. Without this the hook falls
// back to `any` and tool-approval interrupts arrive untyped.
const { useChat } = createChatHook<typeof BOARD_TOOL_DEFS>({
  connection: fetchServerSentEvents('/api/ai/chat'),
  persistence: convexPersistence(fetchConvexToken),
  threadId: 'budget-board',
  // Declared for typing only — the server owns the implementations. Without
  // them a paused tool call arrives as an untyped interrupt and the approval
  // card cannot tell which tool it is confirming.
  tools: BOARD_TOOL_DEFS,
})

export const useBoardChat = () => useChat()

export type BoardChat = ReturnType<typeof useBoardChat>
export type ChatMessages = BoardChat['messages']
