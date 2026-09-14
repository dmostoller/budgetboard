import { describe, expect, test } from 'vite-plus/test'
import { buildAlerts, staleDismissals } from './notifications'
import { DAY } from './board'
import type { Card } from './board'

const now = new Date(2026, 4, 10, 9).getTime()

function card(overrides: Partial<Card> = {}): Card {
  return {
    _id: 'card_1',
    _creationTime: 0,
    userId: 'user_1',
    type: 'expense',
    amountCents: 10000,
    description: 'Rent',
    date: now + 10 * DAY,
    category: 'Rent/Mortgage',
    priority: 'medium',
    recurring: false,
    status: 'upcoming',
    order: 1000,
    createdAt: 0,
    ...overrides,
  }
}

describe('buildAlerts', () => {
  test('says nothing about a card that is comfortably in the future', () => {
    expect(buildAlerts([card()], now)).toEqual([])
  })

  test('never nags about a completed card', () => {
    expect(buildAlerts([card({ date: now - 5 * DAY, status: 'paid' })], now)).toEqual([])
  })

  test('never nags about a wishlist card, however far past its date', () => {
    expect(buildAlerts([card({ date: now - 5 * DAY, status: 'wishlist' })], now)).toEqual([])
    expect(buildAlerts([card({ date: now, status: 'wishlist' })], now)).toEqual([])
  })

  test('raises overdue, due-today and due-soon for expenses', () => {
    const alerts = buildAlerts(
      [
        card({ _id: 'a', date: now - 3 * DAY }),
        card({ _id: 'b', date: new Date(2026, 4, 10, 23).getTime() }),
        card({ _id: 'c', date: now + 4 * DAY }),
      ],
      now,
    )

    expect(alerts.map((a) => a.kind)).toEqual(['overdue', 'due-today', 'due-soon'])
  })

  test('flags income that was expected and never showed up', () => {
    const alerts = buildAlerts(
      [
        card({
          _id: 'i',
          type: 'income',
          status: 'expected',
          description: 'Paycheck',
          date: now - 2 * DAY,
        }),
      ],
      now,
    )

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'income-late', cardId: 'i' })
    expect(alerts[0].title).toContain('Paycheck')
  })

  test('sorts the most urgent first', () => {
    const alerts = buildAlerts(
      [
        card({ _id: 'soon', date: now + 2 * DAY }),
        card({ _id: 'late', date: now - 9 * DAY }),
        card({ _id: 'later', date: now - 2 * DAY }),
      ],
      now,
    )

    expect(alerts.map((a) => a.cardId)).toEqual(['late', 'later', 'soon'])
  })

  test('changes the alert id when the card is rescheduled', () => {
    const [before] = buildAlerts([card({ date: now - DAY })], now)
    const [after] = buildAlerts([card({ date: now - 2 * DAY })], now)
    expect(before.id).not.toBe(after.id)
  })
})

describe('staleDismissals', () => {
  test('identifies dismissals whose alert is gone', () => {
    const alerts = buildAlerts([card({ date: now - DAY })], now)
    expect(staleDismissals([alerts[0].id, 'stale:id'], alerts)).toEqual(['stale:id'])
  })

  test('keeps a dismissal that still matches a live alert', () => {
    const alerts = buildAlerts([card({ date: now - DAY })], now)
    expect(staleDismissals([alerts[0].id], alerts)).toEqual([])
  })
})

describe('alert amounts', () => {
  test('renders the amount in the configured currency', () => {
    const [alert] = buildAlerts([card({ date: now - DAY, amountCents: 120050 })], now, {
      currency: 'USD',
      locale: 'en-US',
    })
    expect(alert.detail).toContain('$1,200.50')
  })
})
