import { useEffect, useMemo } from 'react'
import {
  DAY,
  LANES,
  filterBoardCards,
  forecastByStatus,
  hasActiveFilters,
  isCompleted,
} from '#/lib/board'
import { applyScenario, isScenarioActive } from '#/lib/scenario'
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
  pruneAlerts: (args: { liveAlertIds: Array<string> }) => Promise<unknown>,
  promoteMyDueCards: () => Promise<unknown>,
) {
  const withinHorizon = useMemo(() => {
    if (!cards) return []
    const horizon = now + horizonDays * DAY
    return cards.filter((card) => {
      if (!showCompleted && isCompleted(card.status)) return false
      // Completed cards stay visible regardless of horizon so a just-paid bill
      // does not vanish from under the cursor.
      return card.date <= horizon || isCompleted(card.status)
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

  const budgetsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const budget of budgets?.budgets ?? []) map[budget.category] = budget.limitCents
    return map
  }, [budgets])

  // Dismissals whose alert can no longer occur are dropped, so the table
  // cannot grow forever. Runs when the board settles, not on every render.
  useEffect(() => {
    if (!cards || !dismissedAlerts?.length) return
    const stale = staleDismissals(dismissedAlerts, buildAlerts(cards, Date.now(), money))
    if (stale.length === 0) return
    void pruneAlerts({
      liveAlertIds: buildAlerts(cards, Date.now(), money).map((a) => a.id),
    })
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
    budgetsByCategory,
    forecasts,
    boardIsEmpty,
    completedCount,
    hasBudgets,
    noMatches,
  }
}
