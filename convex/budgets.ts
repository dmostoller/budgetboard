import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { cardCents, getUserId, isCompletedStatus, projectOccurrences, requireUserId } from './lib'

/**
 * A budget is a monthly ceiling on one expense category. Spend is measured
 * against the calendar month the caller asks about, counting both cards
 * already on the board and occurrences a recurring series will produce before
 * the month is out — a budget you have already committed to blowing should
 * say so on the 2nd, not the 28th.
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    return await ctx.db
      .query('budgets')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
  },
})

export const set = mutation({
  args: { category: v.string(), limitCents: v.number() },
  handler: async (ctx, { category, limitCents }) => {
    const userId = await requireUserId(ctx)
    if (!Number.isFinite(limitCents) || limitCents < 0) {
      throw new Error('A budget must be a positive amount')
    }

    const existing = await ctx.db
      .query('budgets')
      .withIndex('by_user_category', (q) => q.eq('userId', userId).eq('category', category))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, { limitCents: Math.round(limitCents) })
      return existing._id
    }
    return await ctx.db.insert('budgets', {
      userId,
      category,
      limitCents: Math.round(limitCents),
    })
  },
})

export const remove = mutation({
  args: { id: v.id('budgets') },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx)
    const budget = await ctx.db.get(id)
    if (!budget || budget.userId !== userId) throw new Error('Budget not found')
    await ctx.db.delete(id)
  },
})

/**
 * Every budget with the month's spend measured against it.
 *
 * `month` is any timestamp inside the month of interest; it defaults to now.
 */
export const progress = query({
  args: { month: v.optional(v.number()) },
  handler: async (ctx, { month }) => {
    const userId = await getUserId(ctx)
    if (!userId) return { monthStart: 0, monthEnd: 0, budgets: [] }

    const anchor = new Date(month ?? Date.now())
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 0, 0, 0, 0).getTime()
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999).getTime()

    const [budgets, cards] = await Promise.all([
      ctx.db
        .query('budgets')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
      ctx.db
        .query('cards')
        .withIndex('by_user_archived', (q) => q.eq('userId', userId).eq('archivedAt', undefined))
        .collect(),
    ])

    const expenses = cards.filter((c) => c.type === 'expense')

    // Spent: completed occurrences dated inside the month.
    const spent = new Map<string, number>()
    for (const card of expenses) {
      if (!isCompletedStatus(card.status)) continue
      if (card.date < start || card.date > end) continue
      spent.set(card.category, (spent.get(card.category) ?? 0) + cardCents(card))
    }

    // Committed: everything still open that lands in the month, including
    // occurrences the recurrence rules will produce before month end.
    const committed = new Map<string, number>()
    const open = expenses
      .filter((c) => !isCompletedStatus(c.status))
      .map((c) => ({ ...c, _id: String(c._id) }))

    for (const { card, date } of projectOccurrences(open, start, end)) {
      if (date < start || date > end) continue
      committed.set(card.category, (committed.get(card.category) ?? 0) + cardCents(card))
    }

    return {
      monthStart: start,
      monthEnd: end,
      budgets: budgets.map((budget) => {
        const spentCents = spent.get(budget.category) ?? 0
        const committedCents = committed.get(budget.category) ?? 0
        return {
          _id: budget._id,
          category: budget.category,
          limitCents: budget.limitCents,
          spentCents,
          committedCents,
          projectedCents: spentCents + committedCents,
          remainingCents: budget.limitCents - (spentCents + committedCents),
        }
      }),
    }
  },
})
