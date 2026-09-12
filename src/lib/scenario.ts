import { cashFlowSeries, cardCents, isCompleted, projectOccurrences } from './board'
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

export interface Scenario {
  /** Ids of real cards to pretend do not exist. */
  mutedCardIds: Array<string>
  /** Cards to pretend do exist. */
  drafts: Array<DraftCard>
}

export const EMPTY_SCENARIO: Scenario = { mutedCardIds: [], drafts: [] }

export function isScenarioActive(scenario: Scenario) {
  return scenario.mutedCardIds.length > 0 || scenario.drafts.length > 0
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

/** The card list a scenario implies: real cards minus mutes, plus drafts. */
export function applyScenario(cards: Array<Card>, scenario: Scenario): Array<Card> {
  const muted = new Set(scenario.mutedCardIds)
  return [...cards.filter((c) => !muted.has(c._id)), ...scenario.drafts.map(draftToCard)]
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
  const to = now + horizonDays * 24 * 60 * 60 * 1000
  const open = cards.filter((c) => !isCompleted(c.status))

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
