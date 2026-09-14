import {
  DAY,
  cardCents,
  cashFlowSeries,
  countsTowardBalance,
  isWishlistStatus,
  projectOccurrences,
} from './board'
import type { Card, CardType, Recurrence } from './board'

/**
 * "What if" without touching the board.
 *
 * A scenario is a set of edits layered over the real cards: occurrences the
 * user has muted, and hypothetical cards they have not committed to. Nothing
 * here writes to Convex — the whole point is to answer "can I afford this"
 * before it becomes true.
 */

export interface DraftCard {
  /** Client-only id; these never reach the database. */
  id: string
  type: CardType
  description: string
  amountCents: number
  date: number
  category: string
  recurring: boolean
  recurrence?: Recurrence
}

/** A wishlist card pretended into the board as a purchase on `date`. */
export interface WishlistPick {
  cardId: string
  date: number
}

export interface Scenario {
  /** Ids of real cards to pretend do not exist. */
  mutedCardIds: Array<string>
  /** Cards to pretend do exist. */
  drafts: Array<DraftCard>
  /** Wishlist cards to pretend were bought. */
  wishlist: Array<WishlistPick>
}

export const EMPTY_SCENARIO: Scenario = { mutedCardIds: [], drafts: [], wishlist: [] }

export function isScenarioActive(scenario: Scenario) {
  return (
    scenario.mutedCardIds.length > 0 || scenario.drafts.length > 0 || scenario.wishlist.length > 0
  )
}

/** A draft rendered as a `Card`, so every downstream chart treats it alike. */
export function draftToCard(draft: DraftCard): Card {
  return {
    _id: draft.id,
    _creationTime: Date.now(),
    userId: 'scenario',
    type: draft.type,
    amountCents: draft.amountCents,
    description: draft.description,
    date: draft.date,
    category: draft.category,
    priority: 'medium',
    recurring: draft.recurring,
    recurrence: draft.recurrence,
    status: draft.type === 'expense' ? 'upcoming' : 'expected',
    order: 0,
    createdAt: Date.now(),
  }
}

/**
 * The card list a scenario implies: real cards minus mutes, plus drafts, with
 * picked wishlist cards turned into ordinary upcoming expenses on their
 * chosen date — which is all it takes for every total to start counting them.
 */
export function applyScenario(cards: Array<Card>, scenario: Scenario): Array<Card> {
  const muted = new Set(scenario.mutedCardIds)
  const picks = new Map(scenario.wishlist.map((pick) => [pick.cardId, pick.date]))

  const adjusted = cards
    .filter((c) => !muted.has(c._id))
    .map((c) => {
      const date = picks.get(c._id)
      if (date === undefined || !isWishlistStatus(c.status)) return c
      return { ...c, status: 'upcoming' as const, date }
    })

  return [...adjusted, ...scenario.drafts.map(draftToCard)]
}

export interface HorizonTotals {
  incomeCents: number
  expenseCents: number
  netCents: number
}

/**
 * Income against expenses over the horizon, with recurring series projected.
 *
 * This is the comparison the board exists to make, so it is computed the same
 * way for the real board and for a scenario — the difference between the two
 * numbers is the entire answer.
 */
export function horizonTotals(
  cards: Array<Card>,
  horizonDays: number,
  now = Date.now(),
): HorizonTotals {
  const to = now + horizonDays * DAY
  const open = cards.filter((c) => countsTowardBalance(c.status))

  let incomeCents = 0
  let expenseCents = 0

  for (const { card } of projectOccurrences(open, now, to)) {
    const cents = cardCents(card)
    if (card.type === 'income') incomeCents += cents
    else expenseCents += cents
  }

  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents }
}

export interface ScenarioComparison {
  baseline: HorizonTotals
  scenario: HorizonTotals
  deltaCents: number
  /** The lowest the running balance gets, and when — the pinch point. */
  baselineTrough: { cents: number; date: number }
  scenarioTrough: { cents: number; date: number }
}

function trough(series: Array<{ date: number; balance: number }>) {
  return series.reduce(
    (low, point) => (point.balance < low.cents ? { cents: point.balance, date: point.date } : low),
    { cents: series[0]?.balance ?? 0, date: series[0]?.date ?? Date.now() },
  )
}

export function compareScenario(
  cards: Array<Card>,
  scenario: Scenario,
  horizonDays: number,
  now = Date.now(),
): ScenarioComparison {
  const adjusted = applyScenario(cards, scenario)
  const baseline = horizonTotals(cards, horizonDays, now)
  const projected = horizonTotals(adjusted, horizonDays, now)

  return {
    baseline,
    scenario: projected,
    deltaCents: projected.netCents - baseline.netCents,
    baselineTrough: trough(cashFlowSeries(cards, horizonDays, now)),
    scenarioTrough: trough(cashFlowSeries(adjusted, horizonDays, now)),
  }
}

/** How far ahead "when can we afford it" is willing to look. */
export const AFFORD_SEARCH_DAYS = 365

export interface Headroom {
  /** Midnight of each day in the window, today first. */
  dates: Array<number>
  /**
   * For each day, the lowest the balance gets from that day to the end of the
   * window. A purchase on day `i` fits exactly when it does not push this
   * below the cushion.
   */
  floor: Array<number>
}

/**
 * The account balance projected day by day, reduced to what a purchase on
 * each day would have to clear.
 *
 * Only open cards count: anything already paid is assumed to be reflected
 * in `startingBalanceCents`. Open cards dated before today (an unpaid bill, a
 * late paycheck) have not happened yet either, so they land on day one
 * rather than falling out of the window.
 */
export function headroom(
  cards: Array<Card>,
  {
    startingBalanceCents = 0,
    days = AFFORD_SEARCH_DAYS,
    now = Date.now(),
  }: { startingBalanceCents?: number; days?: number; now?: number } = {},
): Headroom {
  const open = cards.filter((c) => countsTowardBalance(c.status))
  const series = cashFlowSeries(open, days, now)
  const from = series[0]?.date ?? now

  let carried = startingBalanceCents
  for (const card of open) {
    if (card.date >= from) continue
    carried += card.type === 'income' ? cardCents(card) : -cardCents(card)
  }

  const floor = Array.from({ length: series.length }, () => 0)
  let low = Number.POSITIVE_INFINITY
  for (let i = series.length - 1; i >= 0; i--) {
    low = Math.min(low, series[i].balance + carried)
    floor[i] = low
  }

  return { dates: series.map((point) => point.date), floor }
}

/**
 * The first day a one-off purchase can be made without the balance ever
 * dropping below `cushionCents` afterwards, or `null` if no day in the window
 * works.
 *
 * "Based on what is on the board": expenses nobody has entered yet do not
 * exist here, so the further out the answer, the rosier it is.
 */
export function earliestAffordable(
  room: Headroom,
  amountCents: number,
  cushionCents = 0,
): number | null {
  const index = room.floor.findIndex((low) => low - amountCents >= cushionCents)
  return index === -1 ? null : room.dates[index]
}
