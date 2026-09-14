import { useEffect, useMemo } from 'react'
import {
  DAY,
  LANES,
  cardCents,
  filterBoardCards,
  forecastByStatus,
  hasActiveFilters,
  isCompleted,
  isWishlistStatus,
} from '#/lib/board'
import { applyScenario, earliestAffordable, headroom, isScenarioActive } from '#/lib/scenario'
import { buildAlerts, staleDismissals } from '#/lib/notifications'
import type { BoardFilters, Card, CardStatus, MoneyFormat } from '#/lib/board'
import type { Scenario } from '#/lib/scenario'

type Budgets = { budgets: Array<{ category: string; limitCents: number }> } | undefined

export function useBoardData(
  cards: Array<Card> | undefined,
  horizonDays: number,
  showCompleted: boolean,
  now: number,
  filters: BoardFilters,
  scenario: Scenario,
  budgets: Budgets,
  dismissedAlerts: Array<string> | undefined,
  money: MoneyFormat,
  balanceCents: number | null,
  pruneAlerts: (args: { liveAlertIds: Array<string> }) => Promise<unknown>,
  promoteMyDueCards: () => Promise<unknown>,
) {
  const withinHorizon = useMemo(() => {
    if (!cards) return []
    const horizon = now + horizonDays * DAY
    return cards.filter((card) => {
      if (!showCompleted && isCompleted(card.status)) return false
      // Completed cards stay visible regardless of horizon so a just-paid bill
      // does not vanish from under the cursor. Wishlist dates are wishes, not
      // schedule, so the horizon does not hide them either.
      return card.date <= horizon || isCompleted(card.status) || isWishlistStatus(card.status)
    })
  }, [cards, horizonDays, showCompleted, now])

  const visible = useMemo(() => filterBoardCards(withinHorizon, filters), [withinHorizon, filters])

  const byStatus = useMemo(() => {
    const map = new Map<CardStatus, Array<Card>>()
    for (const lane of LANES) {
      for (const column of lane.columns) map.set(column.status, [])
    }
    for (const card of visible) map.get(card.status)?.push(card)
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [visible])

  const scenarioCards = useMemo(
    () => (isScenarioActive(scenario) ? applyScenario(withinHorizon, scenario) : undefined),
    [withinHorizon, scenario],
  )

  /**
   * The earliest date each wishlist card fits on its own, against the real
   * board. Searched over every live card rather than the horizon, since the
   * answer is often further out than the board looks.
   */
  const affordableFrom = useMemo(() => {
    const map = new Map<string, number | null>()
    const wishes = cards?.filter((c) => isWishlistStatus(c.status)) ?? []
    if (!cards || wishes.length === 0) return map
    const room = headroom(cards, { startingBalanceCents: balanceCents ?? 0, now })
    for (const card of wishes) map.set(card._id, earliestAffordable(room, cardCents(card)))
    return map
  }, [cards, balanceCents, now])

  const budgetsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const budget of budgets?.budgets ?? []) map[budget.category] = budget.limitCents
    return map
  }, [budgets])

  // Dismissals whose alert can no longer occur are dropped, so the table
  // cannot grow forever. Runs when the board settles, not on every render.
  useEffect(() => {
    if (!cards || !dismissedAlerts?.length) return
    const alerts = buildAlerts(cards, Date.now(), money)
    if (staleDismissals(dismissedAlerts, alerts).length === 0) return
    void pruneAlerts({ liveAlertIds: alerts.map((a) => a.id) })
    // `money` is derived from settings and stable enough; the effect is
    // idempotent either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, dismissedAlerts])

  // Catches a bill whose due date arrived while nobody had the board open;
  // the cron sweep would get to it eventually, but this makes it immediate.
  useEffect(() => {
    if (!cards?.some((c) => c.type === 'expense' && c.status === 'upcoming' && c.date <= now)) {
      return
    }
    void promoteMyDueCards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, now])

  const forecasts = forecastByStatus(withinHorizon, horizonDays)
  const boardIsEmpty = cards !== undefined && cards.length === 0
  const completedCount = (cards ?? []).filter((c) => isCompleted(c.status)).length
  const hasBudgets = Boolean(budgets?.budgets.length)
  const noMatches = visible.length === 0 && !boardIsEmpty && hasActiveFilters(filters)

  return {
    withinHorizon,
    visible,
    byStatus,
    scenarioCards,
    affordableFrom,
    budgetsByCategory,
    forecasts,
    boardIsEmpty,
    completedCount,
    hasBudgets,
    noMatches,
  }
}
