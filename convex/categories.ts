import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { cardType } from './schema'
import { getUserId, requireUserId } from './lib'

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent/Mortgage',
  'Utilities',
  'Groceries',
  'Subscriptions',
  'Transportation',
  'Insurance',
  'Healthcare',
  'Entertainment',
  'Dining',
  'Shopping',
  'Debt Payment',
  'Other',
]

export const DEFAULT_INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Refund',
  'Gift',
  'Investment',
  'Other',
]

export const list = query({
  args: {},
  handler: async (ctx) => {
    // Signed out still gets the built-in categories: they are not user data,
    // and the card editor can paint before auth settles.
    const userId = await getUserId(ctx)
    const custom = userId
      ? await ctx.db
          .query('categories')
          .withIndex('by_user', (q) => q.eq('userId', userId))
          .collect()
      : []

    const merge = (defaults: Array<string>, type: 'income' | 'expense') => {
      const names = custom.filter((c) => c.type === type).map((c) => c.name)
      return [...defaults, ...names.filter((n) => !defaults.includes(n))]
    }

    return {
      expense: merge(DEFAULT_EXPENSE_CATEGORIES, 'expense'),
      income: merge(DEFAULT_INCOME_CATEGORIES, 'income'),
      custom,
    }
  },
})

export const add = mutation({
  args: { name: v.string(), type: cardType },
  handler: async (ctx, { name, type }) => {
    const userId = await requireUserId(ctx)
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Category name is required')

    const existing = await ctx.db
      .query('categories')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    const dupe = existing.find(
      (c) => c.type === type && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (dupe) return dupe._id

    return await ctx.db.insert('categories', { userId, name: trimmed, type })
  },
})

/**
 * Delete a custom category, moving anything filed under it somewhere real.
 *
 * Without the reassignment a deleted category leaves its cards pointing at a
 * name the picker can no longer offer — visible on the board, unselectable in
 * the dialog, and silently absent from the category chart's legend.
 */
export const remove = mutation({
  args: { id: v.id('categories'), reassignTo: v.optional(v.string()) },
  handler: async (ctx, { id, reassignTo }) => {
    const userId = await requireUserId(ctx)
    const category = await ctx.db.get(id)
    if (!category || category.userId !== userId) {
      throw new Error('Category not found')
    }

    const fallback = reassignTo ?? 'Other'
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()

    let reassigned = 0
    for (const card of cards) {
      if (card.category !== category.name) continue
      await ctx.db.patch(card._id, { category: fallback })
      reassigned++
    }

    // A budget attached to a category that no longer exists would never be
    // measurable again.
    const budget = await ctx.db
      .query('budgets')
      .withIndex('by_user_category', (q) => q.eq('userId', userId).eq('category', category.name))
      .unique()
    if (budget) await ctx.db.delete(budget._id)

    await ctx.db.delete(id)
    return { reassigned, reassignedTo: fallback }
  },
})

/** How many cards a category is holding, so the UI can warn before deleting. */
export const usage = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx)
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return { count: cards.filter((c) => c.category === name).length }
  },
})
