import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { getUserId, requireUserId } from './lib'

export const DEFAULT_SETTINGS = {
  horizonDays: 30,
  showCompleted: true,
  currency: 'USD',
  locale: 'en-US',
  insightsEnabled: true,
  balanceCents: null as number | null,
  balanceUpdatedAt: null as number | null,
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    // Signed-out renders read defaults rather than throwing, so the shell can
    // paint before the session resolves.
    const userId = await getUserId(ctx)
    if (!userId) return DEFAULT_SETTINGS

    const row = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()

    return {
      horizonDays: row?.horizonDays ?? DEFAULT_SETTINGS.horizonDays,
      showCompleted: row?.showCompleted ?? DEFAULT_SETTINGS.showCompleted,
      currency: row?.currency ?? DEFAULT_SETTINGS.currency,
      locale: row?.locale ?? DEFAULT_SETTINGS.locale,
      insightsEnabled: row?.insightsEnabled ?? DEFAULT_SETTINGS.insightsEnabled,
      balanceCents: row?.balanceCents ?? null,
      balanceUpdatedAt: row?.balanceUpdatedAt ?? null,
    }
  },
})

export const set = mutation({
  args: {
    horizonDays: v.optional(v.number()),
    showCompleted: v.optional(v.boolean()),
    currency: v.optional(v.string()),
    locale: v.optional(v.string()),
    insightsEnabled: v.optional(v.boolean()),
    /** `null` forgets the balance. */
    balanceCents: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, fields) => {
    const userId = await requireUserId(ctx)
    if (
      fields.balanceCents !== undefined &&
      fields.balanceCents !== null &&
      !Number.isFinite(fields.balanceCents)
    ) {
      throw new Error('Balance must be a number')
    }
    // Stamped so the UI can say how stale the figure is.
    const balance =
      fields.balanceCents === undefined
        ? {}
        : fields.balanceCents === null
          ? { balanceCents: undefined, balanceUpdatedAt: undefined }
          : { balanceCents: Math.round(fields.balanceCents), balanceUpdatedAt: Date.now() }
    const row = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()

    if (!row) {
      return await ctx.db.insert('settings', {
        userId,
        horizonDays: fields.horizonDays ?? DEFAULT_SETTINGS.horizonDays,
        showCompleted: fields.showCompleted ?? DEFAULT_SETTINGS.showCompleted,
        currency: fields.currency ?? DEFAULT_SETTINGS.currency,
        locale: fields.locale ?? DEFAULT_SETTINGS.locale,
        insightsEnabled: fields.insightsEnabled ?? DEFAULT_SETTINGS.insightsEnabled,
        ...balance,
      })
    }

    await ctx.db.patch(row._id, {
      horizonDays: fields.horizonDays ?? row.horizonDays,
      showCompleted: fields.showCompleted ?? row.showCompleted,
      currency: fields.currency ?? row.currency,
      locale: fields.locale ?? row.locale,
      insightsEnabled: fields.insightsEnabled ?? row.insightsEnabled,
      ...balance,
    })
    return row._id
  },
})
