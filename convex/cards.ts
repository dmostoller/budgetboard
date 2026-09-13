import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { cardPriority, cardStatus, cardType, recurrence as recurrenceValidator } from './schema'
import {
  cardCents,
  getUserId,
  isCompletedStatus,
  projectOccurrences,
  requireUserId,
  statusesForType,
} from './lib'
import { isWithinEnd, normalizeRecurrence, occurrenceDate } from './recurrence'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { DEFAULT_SETTINGS } from './settings'

const DAY = 24 * 60 * 60 * 1000

/**
 * How far ahead the autoroll job materializes a recurring series, as a window
 * around the user's own horizon. Occurrences past this point are still
 * forecast by the charts and the stats bar; they just do not exist as cards
 * yet, which keeps the board from filling up with rows nobody has to act on.
 *
 * The floor keeps a short horizon from starving the board — next month's rent
 * should appear even on a 1-week view. The ceiling keeps a 1-year horizon from
 * materializing 26 paychecks into a column nobody has to act on.
 */
export const ROLL_AHEAD_MIN_DAYS = 45
export const ROLL_AHEAD_MAX_DAYS = 90

export function rollAheadDays(horizonDays: number) {
  return Math.min(Math.max(horizonDays, ROLL_AHEAD_MIN_DAYS), ROLL_AHEAD_MAX_DAYS)
}

async function ownedCard(ctx: MutationCtx, userId: string, id: Id<'cards'>) {
  const card = await ctx.db.get(id)
  if (!card || card.userId !== userId) {
    throw new Error('Card not found')
  }
  return card
}

/** Next order value at the end of a column. */
async function nextOrder(ctx: MutationCtx, userId: string, status: string) {
  const column = await ctx.db
    .query('cards')
    .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', status as any))
    .collect()
  return column.reduce((max, c) => Math.max(max, c.order), 0) + 1000
}

function assertValidStatus(type: 'income' | 'expense', status: string) {
  if (!(statusesForType(type) as readonly string[]).includes(status)) {
    throw new Error(`Status "${status}" is not valid for a ${type} card`)
  }
}

/** Live cards: everything that has not been rolled into a closed month. */
async function liveCards(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query('cards')
    .withIndex('by_user_archived', (q) => q.eq('userId', userId).eq('archivedAt', undefined))
    .collect()
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const cards = await liveCards(ctx, userId)
    return cards.sort((a, b) => a.order - b.order)
  },
})

/** Cards closed out into history, newest first. */
export const listArchived = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return cards
      .filter((c) => c.archivedAt !== undefined)
      .sort((a, b) => b.date - a.date)
      .slice(0, limit ?? 500)
  },
})

export const get = query({
  args: { id: v.id('cards') },
  handler: async (ctx, { id }) => {
    const userId = await getUserId(ctx)
    if (!userId) return null
    const card = await ctx.db.get(id)
    return card && card.userId === userId ? card : null
  },
})

export const create = mutation({
  args: {
    type: cardType,
    amountCents: v.number(),
    description: v.string(),
    date: v.number(),
    category: v.string(),
    priority: v.optional(cardPriority),
    recurring: v.optional(v.boolean()),
    recurrence: v.optional(recurrenceValidator),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(cardStatus),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const status = args.status ?? (args.type === 'expense' ? 'upcoming' : 'expected')
    assertValidStatus(args.type, status)

    if (!Number.isFinite(args.amountCents) || args.amountCents < 0) {
      throw new Error('Amount must be a positive number')
    }

    const now = Date.now()
    const recurring = args.recurring ?? false
    // Rules are stored explicitly ("monthly on the 14th", never just
    // "monthly") so an occurrence means the same thing wherever it is read.
    const rule =
      recurring && args.recurrence ? normalizeRecurrence(args.recurrence, args.date) : undefined

    const id = await ctx.db.insert('cards', {
      userId,
      type: args.type,
      amountCents: Math.round(args.amountCents),
      description: args.description,
      date: args.date,
      category: args.category,
      priority: args.priority ?? 'medium',
      recurring,
      recurrence: rule,
      source: args.source,
      notes: args.notes,
      status,
      order: await nextOrder(ctx, userId, status),
      createdAt: now,
      completedAt: isCompletedStatus(status) ? now : undefined,
      ...(rule ? { seriesIndex: 0 } : {}),
    })

    // A series is identified by its first card, so the id is only knowable
    // after the insert.
    if (rule) await ctx.db.patch(id, { seriesId: id })

    return id
  },
})

export const update = mutation({
  args: {
    id: v.id('cards'),
    type: v.optional(cardType),
    amountCents: v.optional(v.number()),
    description: v.optional(v.string()),
    date: v.optional(v.number()),
    category: v.optional(v.string()),
    priority: v.optional(cardPriority),
    recurring: v.optional(v.boolean()),
    recurrence: v.optional(recurrenceValidator),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(cardStatus),
    /** Apply the change to every later card in this card's series too. */
    applyToSeries: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, applyToSeries, ...fields }) => {
    const userId = await requireUserId(ctx)
    const card = await ownedCard(ctx, userId, id)
    const type = fields.type ?? card.type
    const patch: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(fields) as Array<[string, unknown]>) {
      if (value !== undefined) patch[key] = value
    }

    if (fields.amountCents !== undefined) {
      if (!Number.isFinite(fields.amountCents) || fields.amountCents < 0) {
        throw new Error('Amount must be a positive number')
      }
      patch.amountCents = Math.round(fields.amountCents)
      // The float column is now stale for this document; drop it so
      // `cardCents` cannot fall back to it.
      patch.amount = undefined
    }

    // Turning recurring off drops the now-irrelevant rule and detaches the
    // card from its series so nothing rolls it forward again.
    if (fields.recurring === false) {
      patch.recurrence = undefined
      patch.seriesId = undefined
      patch.seriesIndex = undefined
    } else if (fields.recurrence) {
      patch.recurrence = normalizeRecurrence(fields.recurrence, fields.date ?? card.date)
    }

    // Changing type moves the card to the default column of the other lane
    // unless an explicit, valid status came with the update.
    const status = (patch.status as string | undefined) ?? card.status
    if (!(statusesForType(type) as readonly string[]).includes(status)) {
      patch.status = type === 'expense' ? 'upcoming' : 'expected'
    }

    if (patch.status && patch.status !== card.status) {
      patch.order = await nextOrder(ctx, userId, patch.status as string)
      patch.completedAt = isCompletedStatus(patch.status as string) ? Date.now() : undefined
    }

    await ctx.db.patch(id, patch)

    if (applyToSeries && card.seriesId) {
      // "Edit this and everything after": later occurrences inherit the
      // change, earlier ones are history and stay as they were.
      const shared = { ...patch }
      delete shared.status
      delete shared.order
      delete shared.completedAt
      delete shared.date
      delete shared.seriesId
      delete shared.seriesIndex

      const siblings = await ctx.db
        .query('cards')
        .withIndex('by_series', (q) => q.eq('seriesId', card.seriesId))
        .collect()

      await Promise.all(
        siblings
          .filter((sibling) => sibling._id !== id && sibling.date > card.date)
          .filter((sibling) => sibling.userId === userId)
          .map((sibling) => ctx.db.patch(sibling._id, shared)),
      )
    }

    if (isCompletedStatus((patch.status as string | undefined) ?? card.status)) {
      await rollSeriesForward(ctx, await ownedCard(ctx, userId, id))
    }

    return id
  },
})

export const move = mutation({
  args: {
    id: v.id('cards'),
    status: cardStatus,
    // order of the card this one was dropped before/after, if any
    beforeOrder: v.optional(v.number()),
    afterOrder: v.optional(v.number()),
  },
  handler: async (ctx, { id, status, beforeOrder, afterOrder }) => {
    const userId = await requireUserId(ctx)
    const card = await ownedCard(ctx, userId, id)
    assertValidStatus(card.type, status)

    let order: number
    if (afterOrder !== undefined && beforeOrder !== undefined) {
      order = (afterOrder + beforeOrder) / 2
    } else if (beforeOrder !== undefined) {
      order = beforeOrder - 1000
    } else if (afterOrder !== undefined) {
      order = afterOrder + 1000
    } else {
      order = await nextOrder(ctx, userId, status)
    }

    await ctx.db.patch(id, {
      status,
      order,
      completedAt: isCompletedStatus(status) ? (card.completedAt ?? Date.now()) : undefined,
    })

    // Completing an occurrence is what pulls the next one onto the board.
    if (isCompletedStatus(status) && !isCompletedStatus(card.status)) {
      await rollSeriesForward(ctx, { ...card, status, order })
    }

    // Everything needed to put the card back exactly where it was, so the
    // toast can offer an undo instead of just an apology.
    return { id, previous: { status: card.status, order: card.order } }
  },
})

export const remove = mutation({
  args: { id: v.id('cards') },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx)
    const card = await ownedCard(ctx, userId, id)
    await ctx.db.delete(id)
    // Returned so an undo can restore the card verbatim; a soft-delete flag
    // would leave tombstones in every query instead.
    return snapshot(card)
  },
})

/** Re-create a card from a `remove` snapshot, for undo. */
export const restore = mutation({
  args: {
    card: v.object({
      type: cardType,
      amountCents: v.number(),
      description: v.string(),
      date: v.number(),
      category: v.string(),
      priority: cardPriority,
      recurring: v.boolean(),
      recurrence: v.optional(recurrenceValidator),
      seriesId: v.optional(v.string()),
      seriesIndex: v.optional(v.number()),
      source: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: cardStatus,
      order: v.number(),
      completedAt: v.optional(v.number()),
      archivedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { card }) => {
    const userId = await requireUserId(ctx)
    return await ctx.db.insert('cards', { ...card, userId, createdAt: Date.now() })
  },
})

function snapshot(card: Doc<'cards'>) {
  return {
    type: card.type,
    amountCents: cardCents(card),
    description: card.description,
    date: card.date,
    category: card.category,
    priority: card.priority,
    recurring: card.recurring,
    recurrence: card.recurrence,
    seriesId: card.seriesId,
    seriesIndex: card.seriesIndex,
    source: card.source,
    notes: card.notes,
    status: card.status,
    order: card.order,
    completedAt: card.completedAt,
    archivedAt: card.archivedAt,
  }
}

/**
 * Copy a card forward.
 *
 * For a recurring card the copy lands on the rule's next occurrence; for a
 * one-off it lands `days` later (default 30), which is the "same as last
 * time" shortcut for things like an irregular bill.
 */
export const duplicate = mutation({
  args: {
    id: v.id('cards'),
    days: v.optional(v.number()),
    date: v.optional(v.number()),
  },
  handler: async (ctx, { id, days, date }) => {
    const userId = await requireUserId(ctx)
    const card = await ownedCard(ctx, userId, id)
    const status = card.type === 'expense' ? 'upcoming' : 'expected'

    const nextDate =
      date ??
      (card.recurring && card.recurrence
        ? (occurrenceDate(card.date, card.recurrence, 1) ?? card.date + (days ?? 30) * DAY)
        : card.date + (days ?? 30) * DAY)

    return await ctx.db.insert('cards', {
      ...snapshot(card),
      userId,
      date: nextDate,
      status,
      order: await nextOrder(ctx, userId, status),
      createdAt: Date.now(),
      completedAt: undefined,
      archivedAt: undefined,
      ...(card.recurring && card.recurrence
        ? {
            seriesId: card.seriesId ?? card._id,
            seriesIndex: (card.seriesIndex ?? 0) + 1,
          }
        : { seriesId: undefined, seriesIndex: undefined }),
    })
  },
})

/**
 * Materialize the next occurrence of a card's series, if the rule has one
 * left and it is not on the board already.
 *
 * Idempotent: it is called both when an occurrence is completed and by the
 * nightly job, and the existence check is what keeps those from producing
 * duplicates.
 */
async function rollSeriesForward(ctx: MutationCtx, card: Doc<'cards'>) {
  if (!card.recurring || !card.recurrence) return null

  const index = (card.seriesIndex ?? 0) + 1
  const nextDate = occurrenceDate(card.date, card.recurrence, 1)
  if (nextDate === null) return null
  if (!isWithinEnd(nextDate, index, card.recurrence)) return null

  const seriesId = card.seriesId ?? card._id
  const existing = await ctx.db
    .query('cards')
    .withIndex('by_series', (q) => q.eq('seriesId', seriesId))
    .collect()

  if (existing.some((c) => c.seriesIndex === index || c.date === nextDate)) return null

  const status = card.type === 'expense' ? 'upcoming' : 'expected'
  const id = await ctx.db.insert('cards', {
    ...snapshot(card),
    userId: card.userId,
    date: nextDate,
    status,
    order: await nextOrder(ctx, card.userId, status),
    createdAt: Date.now(),
    completedAt: undefined,
    archivedAt: undefined,
    seriesId,
    seriesIndex: index,
  })

  // The first card of a pre-existing series may predate seriesId; adopt it so
  // the whole run stays linked.
  if (!card.seriesId) await ctx.db.patch(card._id, { seriesId, seriesIndex: card.seriesIndex ?? 0 })

  return id
}

/**
 * Nightly autoroll.
 *
 * Keeps every live series materialized up to each user's roll-ahead window,
 * so an unpaid bill still gets its successor — the board should show next
 * month's rent whether or not this month's got marked paid.
 */
export const rollAllSeries = internalMutation({
  args: {},
  handler: async (ctx) => {
    // A cross-user sweep cannot use the user-scoped indexes, so this is a
    // full scan by design — it runs once a night, not per request.
    const cards = (await ctx.db.query('cards').collect()).filter((c) => c.archivedAt === undefined)

    // The window is per-user, so a long horizon rolls further than a short one.
    const settings = await ctx.db.query('settings').collect()
    const horizonByUser = new Map(
      settings.map((row) => [
        row.userId,
        Date.now() + rollAheadDays(row.horizonDays ?? DEFAULT_SETTINGS.horizonDays) * DAY,
      ]),
    )
    const defaultHorizon = Date.now() + rollAheadDays(DEFAULT_SETTINGS.horizonDays) * DAY

    // Only a series' newest card can produce the next one.
    const tails = new Map<string, Doc<'cards'>>()
    for (const card of cards) {
      if (!card.recurring || !card.recurrence) continue
      const key = card.seriesId ?? card._id
      const current = tails.get(key)
      if (!current || card.date > current.date) tails.set(key, card)
    }

    let created = 0
    for (const tail of tails.values()) {
      let cursor: Doc<'cards'> | null = tail
      // A series that has fallen far behind catches up in one pass, but never
      // runs away: each step must land inside the roll-ahead window.
      for (let i = 0; i < 24 && cursor; i++) {
        const nextDate = occurrenceDate(cursor.date, cursor.recurrence!, 1)
        if (nextDate === null || nextDate > (horizonByUser.get(cursor.userId) ?? defaultHorizon))
          break
        const id: Id<'cards'> | null = await rollSeriesForward(ctx, cursor)
        if (!id) break
        created++
        cursor = await ctx.db.get(id)
      }
    }

    return { created }
  },
})

/** Move completed cards older than `before` into history. */
export const archiveCompleted = mutation({
  args: { before: v.optional(v.number()) },
  handler: async (ctx, { before }) => {
    const userId = await requireUserId(ctx)
    const cutoff = before ?? Date.now()
    const cards = await liveCards(ctx, userId)
    const now = Date.now()

    const toArchive = cards.filter((card) => isCompletedStatus(card.status) && card.date <= cutoff)
    await Promise.all(toArchive.map((card) => ctx.db.patch(card._id, { archivedAt: now })))
    const archivedIds = toArchive.map((card) => card._id)
    // Ids are returned (not just a count) so the UI can offer an undo that
    // unarchives exactly these cards, not "whatever is archived now".
    return { archived: archivedIds.length, archivedIds }
  },
})

export const unarchiveMany = mutation({
  args: { ids: v.array(v.id('cards')) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUserId(ctx)
    await Promise.all(
      ids.map(async (id) => {
        await ownedCard(ctx, userId, id)
        await ctx.db.patch(id, { archivedAt: undefined })
      }),
    )
    return null
  },
})

export const unarchive = mutation({
  args: { id: v.id('cards') },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx)
    await ownedCard(ctx, userId, id)
    await ctx.db.patch(id, { archivedAt: undefined })
    return id
  },
})

/**
 * Aggregate totals used by the info bar and by the AI's balance queries.
 *
 * Income and expense totals project recurring series forward across the
 * horizon so they stay comparable to a hand-entered run of one-off cards.
 * Overdue/due-soon counts stay anchored to each card's own date — they
 * describe what needs action today, not a forecast.
 */
export const stats = query({
  args: { horizonDays: v.optional(v.number()) },
  handler: async (ctx, { horizonDays }) => {
    const userId = await getUserId(ctx)
    const cards = userId ? await liveCards(ctx, userId) : []

    const now = Date.now()
    const horizon = now + (horizonDays ?? 30) * DAY
    const open = cards.filter((c) => !isCompletedStatus(c.status))

    let upcomingExpenses = 0
    let expectedIncome = 0
    for (const { card } of projectOccurrences(
      open.map((c) => ({ ...c, _id: String(c._id) })),
      now,
      horizon,
    )) {
      const cents = cardCents(card)
      if (card.type === 'expense') upcomingExpenses += cents
      else expectedIncome += cents
    }

    const overdue = open.filter((c) => c.type === 'expense' && c.date < now)
    const dueSoon = open.filter(
      (c) => c.type === 'expense' && c.date >= now && c.date <= now + 7 * DAY,
    )

    return {
      upcomingExpenses,
      expectedIncome,
      net: expectedIncome - upcomingExpenses,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, c) => sum + cardCents(c), 0),
      dueSoonCount: dueSoon.length,
      dueSoonAmount: dueSoon.reduce((sum, c) => sum + cardCents(c), 0),
      totalCards: cards.length,
    }
  },
})
