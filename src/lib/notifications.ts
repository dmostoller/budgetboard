import { DAY, cardCents, countsTowardBalance, formatCents, relativeDue } from './board'
import type { Card, MoneyFormat } from './board'

export type AlertKind = 'overdue' | 'due-today' | 'due-soon' | 'income-late'

export interface Alert {
  /** Stable across renders, reloads and devices, so a dismissal sticks. */
  id: string
  kind: AlertKind
  cardId: string
  title: string
  detail: string
  date: number
}

const KIND_WEIGHT: Record<AlertKind, number> = {
  overdue: 0,
  'due-today': 1,
  'due-soon': 2,
  'income-late': 3,
}

function sameDay(a: number, b: number) {
  const left = new Date(a)
  const right = new Date(b)
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

/**
 * Alerts are derived from the cards themselves rather than stored, so they can
 * never drift out of sync with the board. The id folds in the card's date and
 * status, which means dismissing an alert hides *that* state — if the bill
 * slips another week, it speaks up again.
 *
 * The dismissals live in Convex (`convex/alerts.ts`), not in this browser, so
 * silencing a bill on a laptop also silences it on a phone.
 */
export function buildAlerts(
  cards: Array<Card>,
  now = Date.now(),
  money?: MoneyFormat,
): Array<Alert> {
  const alerts: Array<Alert> = []

  for (const card of cards) {
    // Completed cards need nothing, and a wishlist date is not a deadline.
    if (!countsTowardBalance(card.status)) continue

    const amount = formatCents(cardCents(card), money)
    const base = { cardId: card._id, date: card.date }
    const id = `${card._id}:${card.status}:${card.date}`

    if (card.type === 'expense') {
      if (card.date < now && !sameDay(card.date, now)) {
        alerts.push({
          ...base,
          id,
          kind: 'overdue',
          title: `${card.description} is overdue`,
          detail: `${amount} · due ${relativeDue(card.date, now)}`,
        })
      } else if (sameDay(card.date, now)) {
        alerts.push({
          ...base,
          id,
          kind: 'due-today',
          title: `${card.description} is due today`,
          detail: amount,
        })
      } else if (card.date <= now + 7 * DAY) {
        alerts.push({
          ...base,
          id,
          kind: 'due-soon',
          title: `${card.description} is due ${relativeDue(card.date, now)}`,
          detail: amount,
        })
      }
    } else if (card.date < now && !sameDay(card.date, now)) {
      alerts.push({
        ...base,
        id,
        kind: 'income-late',
        title: `${card.description} hasn’t arrived`,
        detail: `${amount} · expected ${relativeDue(card.date, now)}`,
      })
    }
  }

  return alerts.sort((a, b) => KIND_WEIGHT[a.kind] - KIND_WEIGHT[b.kind] || a.date - b.date)
}

/** Dismissals whose alert no longer exists, so the stored list can be pruned. */
export function staleDismissals(dismissed: Array<string>, alerts: Array<Alert>) {
  const live = new Set(alerts.map((a) => a.id))
  return dismissed.filter((id) => !live.has(id))
}
