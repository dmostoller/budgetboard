import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getUserId, requireUserId } from './lib'

/**
 * Storage behind the assistant's `ChatClientPersistence` adapter.
 *
 * TanStack AI hands over one opaque `ChatPersistedState` blob per thread —
 * the transcript plus a resume pointer for a run that was still in flight.
 * The shape belongs to the chat client, so it is stored as-is rather than
 * modelled here; keeping it server-side is what makes a conversation (and a
 * half-answered approval) survive a reload on a different device.
 */

export const getThread = query({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null

    const row = await ctx.db
      .query('chatThreads')
      .withIndex('by_user_thread', (q) => q.eq('userId', userId).eq('threadId', threadId))
      .unique()
    return row?.state ?? null
  },
})

export const setThread = mutation({
  args: { threadId: v.string(), state: v.any() },
  handler: async (ctx, { threadId, state }) => {
    const userId = await requireUserId(ctx)
    const row = await ctx.db
      .query('chatThreads')
      .withIndex('by_user_thread', (q) => q.eq('userId', userId).eq('threadId', threadId))
      .unique()

    if (row) {
      await ctx.db.patch(row._id, { state, updatedAt: Date.now() })
      return row._id
    }
    return await ctx.db.insert('chatThreads', {
      userId,
      threadId,
      state,
      updatedAt: Date.now(),
    })
  },
})

export const clearThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    const userId = await requireUserId(ctx)
    const row = await ctx.db
      .query('chatThreads')
      .withIndex('by_user_thread', (q) => q.eq('userId', userId).eq('threadId', threadId))
      .unique()
    if (row) await ctx.db.delete(row._id)
  },
})
