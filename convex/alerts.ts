import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getUserId, requireUserId } from './lib'

/**
 * Alerts themselves are derived from the cards on every render, so they can
 * never drift out of sync with the board. Only the dismissals are stored —
 * and stored server-side, so silencing a bill on a laptop also silences it on
 * a phone.
 *
 * An alert id folds in the card's date and status, which means a dismissal
 * covers *that* state: if the bill slips another week it speaks up again
 * under a new id.
 */

export const listDismissed = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('alertDismissals')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return rows.map((r) => r.alertId)
  },
})

export const dismiss = mutation({
  args: { alertIds: v.array(v.string()) },
  handler: async (ctx, { alertIds }) => {
    const userId = await requireUserId(ctx)
    const now = Date.now()

    await Promise.all(
      alertIds.map(async (alertId) => {
        const existing = await ctx.db
          .query('alertDismissals')
          .withIndex('by_user_alert', (q) => q.eq('userId', userId).eq('alertId', alertId))
          .unique()
        if (existing) return
        await ctx.db.insert('alertDismissals', { userId, alertId, dismissedAt: now })
      }),
    )
  },
})

export const undismiss = mutation({
  args: { alertId: v.string() },
  handler: async (ctx, { alertId }) => {
    const userId = await requireUserId(ctx)
    const existing = await ctx.db
      .query('alertDismissals')
      .withIndex('by_user_alert', (q) => q.eq('userId', userId).eq('alertId', alertId))
      .unique()
    if (existing) await ctx.db.delete(existing._id)
  },
})

/**
 * Drop dismissals whose alert can no longer exist, so the table cannot grow
 * without bound. The client passes the ids still live on the board.
 */
export const prune = mutation({
  args: { liveAlertIds: v.array(v.string()) },
  handler: async (ctx, { liveAlertIds }) => {
    const userId = await requireUserId(ctx)
    const live = new Set(liveAlertIds)
    const rows = await ctx.db
      .query('alertDismissals')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    const toDelete = rows.filter((row) => !live.has(row.alertId))
    await Promise.all(toDelete.map((row) => ctx.db.delete(row._id)))
    return { pruned: toDelete.length }
  },
})
