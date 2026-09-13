import { internalMutation } from './_generated/server'
import { normalizeRecurrence } from './recurrence'

/**
 * One-time backfills. Run from the dashboard or:
 *
 *   npx convex run migrations:toCents
 *   npx convex run migrations:normalizeRules
 *   npx convex run migrations:adoptSeriesIds
 *
 * Each is idempotent, so re-running is safe.
 */

/**
 * Move float dollars into whole cents.
 *
 * `amount` is left in place rather than deleted so a bad conversion can be
 * inspected; `cardCents()` prefers `amountCents` once it exists, so the float
 * stops being read the moment a document is converted.
 */
export const toCents = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cards = await ctx.db.query('cards').collect()
    const toConvert = cards.flatMap((card) =>
      card.amountCents === undefined && card.amount !== undefined
        ? [{ id: card._id, amount: card.amount }]
        : [],
    )
    await Promise.all(
      toConvert.map(({ id, amount }) =>
        ctx.db.patch(id, { amountCents: Math.round(amount * 100) }),
      ),
    )

    return { converted: toConvert.length, total: cards.length }
  },
})

/**
 * Make every stored recurrence rule explicit.
 *
 * A rule saved as bare "monthly" resolved its day against whatever date it
 * was read from, which is how a series dated the 31st slid onto the 28th and
 * stayed there. Pinning the day to the card's own date freezes the rule's
 * meaning.
 */
export const normalizeRules = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cards = await ctx.db.query('cards').collect()
    const toNormalize = cards.flatMap((card) => {
      if (!card.recurring || !card.recurrence) return []
      const rule = normalizeRecurrence(card.recurrence, card.date)
      if (JSON.stringify(rule) === JSON.stringify(card.recurrence)) return []
      return [{ id: card._id, rule }]
    })
    await Promise.all(toNormalize.map(({ id, rule }) => ctx.db.patch(id, { recurrence: rule })))

    return { normalized: toNormalize.length, total: cards.length }
  },
})

/**
 * Give pre-existing recurring cards a series identity so the autoroll job can
 * find their tail. Cards copied forward by hand before this existed stay
 * separate series — they are indistinguishable from deliberate one-offs.
 */
export const adoptSeriesIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cards = await ctx.db.query('cards').collect()
    const toAdopt = cards.filter(
      (card) => card.recurring && card.recurrence && card.seriesId === undefined,
    )
    await Promise.all(
      toAdopt.map((card) => ctx.db.patch(card._id, { seriesId: card._id, seriesIndex: 0 })),
    )

    return { adopted: toAdopt.length, total: cards.length }
  },
})
