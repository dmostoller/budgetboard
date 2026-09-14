import { api } from '../../convex/_generated/api'
import { getConvexServerClient } from './convex-server'
import { DAY, formatCents, formatDate, fromDateInput, toCents, toDateInput } from './board'
import { earliestAffordable, headroom } from './scenario'
import type { Card } from './board'
import {
  checkBudgetsDef,
  createCardDef,
  deleteCardDef,
  duplicateCardDef,
  listCardsDef,
  moveCardDef,
  queryBalanceDef,
  recurrenceSchema,
  setBudgetDef,
  suggestCategoryDef,
  updateCardDef,
  whenCanWeAffordDef,
} from './ai-tool-defs'
import type { z } from 'zod'
import type { Id } from '../../convex/_generated/dataModel'

/** Parse a YYYY-MM-DD string at local noon so the day never shifts. */
function parseDate(value: string) {
  const ms = fromDateInput(value)
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid date "${value}" — expected YYYY-MM-DD`)
  }
  return ms
}

function parseRecurrence(input: z.infer<typeof recurrenceSchema> | undefined) {
  if (!input) return undefined
  const { endsOn, ...rest } = input
  return { ...rest, ...(endsOn ? { endsOn: parseDate(endsOn) } : {}) }
}

export interface CardFilters {
  type?: 'income' | 'expense'
  status?: 'wishlist' | 'upcoming' | 'due' | 'paid' | 'expected' | 'received'
  category?: string
  recurring?: boolean
  search?: string
  withinDays?: number
  includeCompleted?: boolean
}

type CardRecord = {
  _id: string
  type: 'income' | 'expense'
  amountCents?: number
  amount?: number
  description: string
  date: number
  category: string
  priority: 'low' | 'medium' | 'high'
  recurring: boolean
  source?: string
  status: 'wishlist' | 'upcoming' | 'due' | 'paid' | 'expected' | 'received'
}

function centsOf(card: CardRecord) {
  if (card.amountCents !== undefined) return card.amountCents
  if (card.amount !== undefined) return Math.round(card.amount * 100)
  return 0
}

function summarize(card: CardRecord) {
  return {
    id: card._id,
    // Dollars, not cents: the model reasons about money the way a person
    // writes it, and every number it emits goes back through `toCents`.
    amount: centsOf(card) / 100,
    type: card.type,
    description: card.description,
    date: formatDate(card.date),
    category: card.category,
    priority: card.priority,
    recurring: card.recurring,
    source: card.source,
    status: card.status,
  }
}

/**
 * The filtering behind the `listCards` tool, kept pure so it can be tested
 * without a Convex deployment.
 */
export function filterCards<T extends CardRecord>(
  cards: Array<T>,
  filters: CardFilters,
  now = Date.now(),
): Array<T> {
  const search = filters.search?.toLowerCase()

  return cards.filter((card) => {
    if (filters.type && card.type !== filters.type) return false
    if (filters.status && card.status !== filters.status) return false
    if (filters.category && card.category.toLowerCase() !== filters.category.toLowerCase()) {
      return false
    }
    if (filters.recurring !== undefined && card.recurring !== filters.recurring) {
      return false
    }
    if (
      filters.includeCompleted === false &&
      (card.status === 'paid' || card.status === 'received')
    ) {
      return false
    }
    if (filters.withinDays !== undefined && card.date > now + filters.withinDays * DAY) {
      return false
    }
    if (search) {
      const haystack = `${card.description} ${card.source ?? ''} ${card.category}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

/**
 * Server implementations for the shared tool definitions.
 *
 * The Convex client carries the caller's JWT, so every write lands on that
 * user's board and nothing the model says can redirect it. The user id is no
 * longer a tool argument at all — Convex derives it from the token.
 *
 * Tools declared with `needsApproval` in `ai-tool-defs.ts` never reach these
 * handlers until the user has approved them in the UI.
 */
export function createBoardTools(convexToken: string | null) {
  const convex = getConvexServerClient()
  if (convexToken) convex.setAuth(convexToken)

  const createCard = createCardDef.server(async ({ amount, date, recurrence, ...input }) => {
    const id = await convex.mutation(api.cards.create, {
      ...input,
      amountCents: toCents(amount),
      date: parseDate(date),
      recurrence: parseRecurrence(recurrence),
    })
    return {
      id: String(id),
      summary: `Created ${input.type} card "${input.description}" for ${formatCents(
        toCents(amount),
      )} on ${date}`,
    }
  })

  const updateCard = updateCardDef.server(async ({ id, amount, date, recurrence, ...fields }) => {
    await convex.mutation(api.cards.update, {
      id: id as Id<'cards'>,
      ...fields,
      ...(amount !== undefined ? { amountCents: toCents(amount) } : {}),
      ...(date ? { date: parseDate(date) } : {}),
      ...(recurrence ? { recurrence: parseRecurrence(recurrence) } : {}),
    })
    return { id, summary: 'Card updated' }
  })

  const moveCard = moveCardDef.server(async ({ id, status }) => {
    await convex.mutation(api.cards.move, { id: id as Id<'cards'>, status })
    return { id, summary: `Card moved to ${status}` }
  })

  const deleteCard = deleteCardDef.server(async ({ id, description }) => {
    await convex.mutation(api.cards.remove, { id: id as Id<'cards'> })
    return { id, summary: `Deleted "${description}"` }
  })

  const duplicateCard = duplicateCardDef.server(async ({ id, days, date }) => {
    const created = await convex.mutation(api.cards.duplicate, {
      id: id as Id<'cards'>,
      days,
      ...(date ? { date: parseDate(date) } : {}),
    })
    return { id: String(created), summary: 'Card copied forward' }
  })

  const listCards = listCardsDef.server(async (filters) => {
    const cards: Array<CardRecord> = await convex.query(api.cards.list, {})
    const matched = filterCards(cards, filters)
    return { count: matched.length, cards: matched.map(summarize) }
  })

  const queryBalance = queryBalanceDef.server(async ({ withinDays }) => {
    const horizonDays = withinDays ?? 30
    const stats = await convex.query(api.cards.stats, { horizonDays })
    return {
      // Cents on the wire, dollars in the model's head.
      upcomingExpenses: stats.upcomingExpenses / 100,
      expectedIncome: stats.expectedIncome / 100,
      net: stats.net / 100,
      overdueCount: stats.overdueCount,
      overdueAmount: stats.overdueAmount / 100,
      dueSoonCount: stats.dueSoonCount,
      dueSoonAmount: stats.dueSoonAmount / 100,
      horizonDays,
    }
  })

  const suggestCategory = suggestCategoryDef.server(async ({ type }) => {
    const categories = await convex.query(api.categories.list, {})
    return { categories: categories[type] }
  })

  const checkBudgets = checkBudgetsDef.server(async () => {
    const result = await convex.query(api.budgets.progress, {})
    return {
      budgets: result.budgets.map((b) => ({
        category: b.category,
        limit: b.limitCents / 100,
        spent: b.spentCents / 100,
        committed: b.committedCents / 100,
        remaining: b.remainingCents / 100,
      })),
    }
  })

  const setBudget = setBudgetDef.server(async ({ category, limit }) => {
    await convex.mutation(api.budgets.set, { category, limitCents: toCents(limit) })
    return { summary: `Budget for ${category} set to ${formatCents(toCents(limit))} a month` }
  })

  const whenCanWeAfford = whenCanWeAffordDef.server(async ({ cardId, amount, cushion }) => {
    const [cards, settings] = await Promise.all([
      convex.query(api.cards.list, {}) as Promise<Array<Card>>,
      convex.query(api.settings.get, {}),
    ])
    const card = cardId ? cards.find((c) => c._id === cardId) : undefined
    if (cardId && !card) throw new Error(`No card with id "${cardId}"`)

    const priceCents = card ? centsOf(card) : toCents(amount ?? 0)
    if (priceCents <= 0) throw new Error('Pass a wishlist card id or a positive amount')

    // A non-wishlist card is already counted; checking it against a board
    // that includes it would charge for it twice.
    const board = card ? cards.filter((c) => c._id !== card._id) : cards
    const room = headroom(board, { startingBalanceCents: settings.balanceCents ?? 0 })
    const date = earliestAffordable(room, priceCents, toCents(cushion ?? 0))
    const label = card ? `"${card.description}"` : formatCents(priceCents)

    return {
      date: date === null ? null : toDateInput(date),
      amount: priceCents / 100,
      startingBalance: settings.balanceCents === null ? null : settings.balanceCents / 100,
      summary:
        date === null
          ? `${label} does not fit within the next year at current cash flow`
          : `${label} fits from ${formatDate(date)}`,
    }
  })

  return [
    createCard,
    updateCard,
    moveCard,
    deleteCard,
    duplicateCard,
    listCards,
    queryBalance,
    suggestCategory,
    checkBudgets,
    setBudget,
    whenCanWeAfford,
  ]
}

export function boardSystemPrompt(now = new Date()) {
  return `You are the assistant inside Budget Board, a kanban board for personal cash flow.

Today's date is ${now.toDateString()} (${now.toISOString().slice(0, 10)}). Resolve every
relative date the user gives you ("the 15th", "next Friday", "monthly") against
that date and pass an absolute YYYY-MM-DD to the tools.

The board has three swimlanes:
- Expenses: columns "upcoming", "due", "paid"
- Income: columns "expected", "received"
- Wishlist: column "wishlist", for expenses the user would like to make someday
  but has not committed to. Wishlist cards are one-offs, their date means
  "want by", and they count toward no totals, budgets or alerts. Move one to
  "upcoming" once the user decides to buy it.

Amounts are in dollars everywhere in these tools; the card type decides the
direction, so always pass a positive number.

Recurrence rules support more than "every month":
- interval: "every 2 weeks" is {frequency: "weekly", interval: 2}
- nthWeekday: "the second Friday" is {ordinal: 2, weekday: 5}; ordinal -1 means
  the last one in the month
- dayOfMonth: -1 means the last day of the month
- endsAfter / endsOn: "repeats 4 times" or "until June" — set these whenever the
  user gives the repeat an end, rather than leaving the series running forever

Rules:
- When the user describes money moving, create or update cards with the tools —
  do not just describe what you would do.
- Before creating a card, pick a category from suggestCategory for that type.
  Only invent a category name when nothing existing fits.
- Mark subscriptions, rent, salary and similar repeats as recurring, and give
  them an explicit recurrence rule.
- To change or move an existing card, call listCards first to find its id.
- updateCard, deleteCard and setBudget pause for the user's confirmation. Call
  them normally when they are the right action; do not ask for permission in
  prose first, and do not retry a call the user rejected — acknowledge it and
  move on.
- Answer money questions with queryBalance, checkBudgets or listCards rather
  than guessing. For "when can we afford X", use whenCanWeAfford.
- Keep replies short — one or two sentences confirming what changed. The board
  updates itself, so there is no need to restate every field.`
}
