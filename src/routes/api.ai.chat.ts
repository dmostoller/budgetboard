import { createFileRoute } from '@tanstack/react-router'
import { chat, maxIterations, toServerSentEventsResponse } from '@tanstack/ai'
import { geminiText } from '@tanstack/ai-gemini'
import { auth } from '#/lib/auth'
import { boardSystemPrompt, createBoardTools } from '#/lib/ai-tools'

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

export const Route = createFileRoute('/api/ai/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (request.signal.aborted) {
          return new Response(null, { status: 499 })
        }

        const session = await auth.api.getSession({ headers: request.headers })
        if (!session?.user) {
          return Response.json({ error: 'Not signed in' }, { status: 401 })
        }

        // The tools talk to Convex as this user. Minting the same JWT the
        // browser uses means the server path is scoped by the identical
        // identity check — there is no privileged back door that trusts a
        // user id passed in an argument.
        const { token: convexToken } = await auth.api.getToken({ headers: request.headers })

        if (!process.env.GEMINI_API_KEY) {
          return Response.json(
            { error: 'GEMINI_API_KEY is not configured on the server' },
            { status: 500 },
          )
        }

        const abortController = new AbortController()

        try {
          const { messages } = await request.json()

          const stream = chat({
            adapter: geminiText(MODEL as any),
            tools: createBoardTools(convexToken ?? null),
            systemPrompts: [boardSystemPrompt()],
            agentLoopStrategy: maxIterations(8),
            messages,
            abortController,
          })

          return toServerSentEventsResponse(stream, { abortController })
        } catch (error: any) {
          if (error?.name === 'AbortError' || abortController.signal.aborted) {
            return new Response(null, { status: 499 })
          }
          console.error('AI chat request failed', error)
          return Response.json({ error: 'Failed to process chat request' }, { status: 500 })
        }
      },
    },
  },
})
