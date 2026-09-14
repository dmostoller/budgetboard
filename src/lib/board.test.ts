import { describe, expect, test } from 'vite-plus/test'
import {
  DAY,
  cashFlowSeries,
  centsToInput,
  columnsForType,
  defaultStatusFor,
  describeRecurrence,
  filterBoardCards,
  forecastByStatus,
  formatCents,
  fromDateInput,
  hasActiveFilters,
  nextOccurrence,
  outflowSeries,
  occurrencesInRange,
  projectOccurrences,
  relativeDue,
  statusLabel,
  toCents,
  toDateInput,
  typeForStatus,
  urgency,
} from './board'
import type { Card, Recurrence } from './board'

function card(overrides: Partial<Card> = {}): Card {
  return {
    _id: 'card_1',
    _creationTime: 0,
    userId: 'user_1',
    type: 'expense',
    amountCents: 10000,
    description: 'Rent',
    date: Date.now() + 10 * DAY,
    category: 'Rent/Mortgage',
    priority: 'medium',
    recurring: false,
    status: 'upcoming',
    order: 1000,
    createdAt: 0,
    ...overrides,
  }
}

describe('date helpers', () => {
  test('round-trips a date input through local noon', () => {
    const ms = fromDateInput('2026-02-15')
    expect(toDateInput(ms)).toBe('2026-02-15')
    expect(new Date(ms).getHours()).toBe(12)
  })

  test('keeps the day stable regardless of timezone offset', () => {
    const ms = fromDateInput('2026-01-01')
    expect(new Date(ms).getDate()).toBe(1)
    expect(new Date(ms).getMonth()).toBe(0)
  })

  test('describes due dates relative to today', () => {
    const now = Date.now()
    expect(relativeDue(now, now)).toBe('today')
    expect(relativeDue(now + DAY, now)).toBe('tomorrow')
    expect(relativeDue(now - DAY, now)).toBe('yesterday')
    expect(relativeDue(now - 4 * DAY, now)).toBe('4 days ago')
    expect(relativeDue(now + 6 * DAY, now)).toBe('in 6 days')
  })
})

describe('urgency', () => {
  const now = Date.now()

  test('flags a past-due open card as overdue', () => {
    expect(urgency(card({ date: now - DAY }), now)).toBe('overdue')
  })

  test('flags anything inside a week as due soon', () => {
    expect(urgency(card({ date: now + 3 * DAY }), now)).toBe('due-soon')
  })

  test('leaves later cards alone', () => {
    expect(urgency(card({ date: now + 20 * DAY }), now)).toBe('later')
  })

  test('never nags about a completed card', () => {
    expect(urgency(card({ date: now - 30 * DAY, status: 'paid' }), now)).toBe('done')
    expect(urgency(card({ type: 'income', status: 'received', date: now - DAY }), now)).toBe('done')
  })
})

describe('describeRecurrence', () => {
  test('describes a weekly rule', () => {
    expect(describeRecurrence({ frequency: 'weekly', interval: 1, weekday: 3 })).toBe(
      'Weekly on Wednesday',
    )
  })

  test('describes a biweekly rule, e.g. a paycheck', () => {
    expect(describeRecurrence({ frequency: 'weekly', interval: 2, weekday: 3 })).toBe(
      'Every 2 weeks on Wednesday',
    )
  })

  test('describes a monthly rule, e.g. a mortgage payment', () => {
    expect(describeRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 1 })).toBe(
      'Monthly on the 1st',
    )
  })

  test('describes a multi-month rule with the right ordinal suffix', () => {
    expect(describeRecurrence({ frequency: 'monthly', interval: 3, dayOfMonth: 22 })).toBe(
      'Every 3 months on the 22nd',
    )
  })
})

describe('nextOccurrence', () => {
  test('lands on the next matching weekday, honoring the interval', () => {
    const wednesday = fromDateInput('2026-03-04') // a Wednesday
    const rule: Recurrence = { frequency: 'weekly', interval: 2, weekday: 3 }
    const next = nextOccurrence(wednesday, rule)!
    expect(toDateInput(next)).toBe('2026-03-18')
    expect(new Date(next).getDay()).toBe(3)
  })

  test('finds the nearest future weekday for a weekly rule', () => {
    const monday = fromDateInput('2026-03-02') // a Monday
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekday: 3 }
    expect(toDateInput(nextOccurrence(monday, rule)!)).toBe('2026-03-04')
  })

  test('advances a monthly rule by the configured interval', () => {
    const jan1 = fromDateInput('2026-01-01')
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }
    expect(toDateInput(nextOccurrence(jan1, rule)!)).toBe('2026-02-01')
  })

  test('clamps a monthly rule to the last day of a shorter month', () => {
    const jan31 = fromDateInput('2026-01-31')
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 31 }
    expect(toDateInput(nextOccurrence(jan31, rule)!)).toBe('2026-02-28')
  })
})

describe('occurrencesInRange', () => {
  test('a one-off card only lands on its own date', () => {
    const now = Date.now()
    const date = now + 10 * DAY
    expect(occurrencesInRange(date, undefined, now, now + 30 * DAY)).toEqual([date])
  })

  test('projects a biweekly paycheck across a wide horizon', () => {
    const now = fromDateInput('2026-09-06') // a Sunday
    const rule: Recurrence = { frequency: 'weekly', interval: 2, weekday: 3 }
    const paycheck = card({ date: now + 3 * DAY, recurring: true, recurrence: rule })

    const occurrences = occurrencesInRange(paycheck.date, rule, now, now + 60 * DAY)
    expect(occurrences).toHaveLength(5)
    expect(occurrences.every((d) => new Date(d).getDay() === 3)).toBe(true)
    // ~14 days apart — rounded to absorb DST's odd hour across the range
    expect(
      occurrences.every((_, i, all) => i === 0 || Math.round((all[i] - all[i - 1]) / DAY) === 14),
    ).toBe(true)
  })

  test('always includes the card’s own date, even if overdue', () => {
    const now = Date.now()
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }
    const overdue = card({ date: now - 2 * DAY, recurring: true, recurrence: rule })

    const occurrences = occurrencesInRange(overdue.date, rule, now, now + 30 * DAY)
    expect(occurrences[0]).toBe(overdue.date)
  })

  test('returns nothing once the card’s own date is past the horizon', () => {
    const now = Date.now()
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }
    const farOut = card({ date: now + 90 * DAY, recurring: true, recurrence: rule })
    expect(occurrencesInRange(farOut.date, rule, now, now + 30 * DAY)).toEqual([])
  })
})

describe('lane vocabulary', () => {
  test('maps every status back to its lane', () => {
    expect(typeForStatus('wishlist')).toBe('expense')
    expect(typeForStatus('upcoming')).toBe('expense')
    expect(typeForStatus('due')).toBe('expense')
    expect(typeForStatus('paid')).toBe('expense')
    expect(typeForStatus('expected')).toBe('income')
    expect(typeForStatus('received')).toBe('income')
  })

  test('labels statuses the way the columns are titled', () => {
    expect(statusLabel('upcoming')).toBe('Upcoming')
    expect(statusLabel('received')).toBe('Received')
    expect(statusLabel('wishlist')).toBe('Wishlist')
  })

  test('the wishlist is an expense column, but not the default one', () => {
    expect(columnsForType('expense').map((c) => c.status)).toEqual([
      'upcoming',
      'due',
      'paid',
      'wishlist',
    ])
    expect(columnsForType('income').map((c) => c.status)).toEqual(['expected', 'received'])
    expect(defaultStatusFor('expense')).toBe('upcoming')
  })

  test('a wishlist date is never overdue', () => {
    const wish = { status: 'wishlist', date: Date.now() - 30 * DAY } as Parameters<
      typeof urgency
    >[0]
    expect(urgency(wish)).toBe('later')
  })
})

describe('money', () => {
  test('parses typed amounts into whole cents', () => {
    expect(toCents('12')).toBe(1200)
    expect(toCents('12.5')).toBe(1250)
    expect(toCents('12.55')).toBe(1255)
    expect(toCents('$1,200.55')).toBe(120055)
    expect(toCents('')).toBe(0)
    expect(toCents('abc')).toBe(0)
  })

  test('round-trips cents through the input format', () => {
    expect(centsToInput(1200)).toBe('12')
    expect(centsToInput(1250)).toBe('12.50')
    expect(toCents(centsToInput(120055))).toBe(120055)
  })

  test('never accumulates float error across a long series', () => {
    // The reason amounts are integers: 100 × $0.10 in floats is not $10.
    const cents = Array.from({ length: 100 }, () => toCents('0.10'))
    expect(cents.reduce((a, b) => a + b, 0)).toBe(1000)
  })

  test('formats in the configured currency', () => {
    expect(formatCents(120000, { currency: 'USD', locale: 'en-US' })).toBe('$1,200')
    expect(formatCents(120050, { currency: 'USD', locale: 'en-US' })).toBe('$1,200.50')
  })
})

describe('filterBoardCards', () => {
  const cards = [
    card({ _id: 'a', description: 'Rent', category: 'Rent/Mortgage', amountCents: 120000 }),
    card({
      _id: 'b',
      description: 'Netflix',
      category: 'Subscriptions',
      amountCents: 1500,
      recurring: true,
      priority: 'low',
    }),
    card({
      _id: 'c',
      type: 'income',
      description: 'Payday',
      category: 'Salary',
      status: 'expected',
      amountCents: 240000,
    }),
    card({ _id: 'd', description: 'Vet visit', category: 'Healthcare', notes: 'for the dog' }),
  ]

  const ids = (filters: Parameters<typeof filterBoardCards>[1]) =>
    filterBoardCards(cards, filters).map((c) => c._id)

  test('returns everything when nothing is set', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd'])
    expect(hasActiveFilters({})).toBe(false)
  })

  test('searches description, category and notes', () => {
    expect(ids({ search: 'netflix' })).toEqual(['b'])
    expect(ids({ search: 'salary' })).toEqual(['c'])
    expect(ids({ search: 'dog' })).toEqual(['d'])
  })

  test('filters by type, priority and recurrence', () => {
    expect(ids({ types: ['income'] })).toEqual(['c'])
    expect(ids({ priorities: ['low'] })).toEqual(['b'])
    expect(ids({ recurringOnly: true })).toEqual(['b'])
  })

  test('filters by category and amount range', () => {
    expect(ids({ categories: ['Healthcare'] })).toEqual(['d'])
    expect(ids({ minCents: 100000 })).toEqual(['a', 'c'])
    expect(ids({ maxCents: 2000 })).toEqual(['b'])
  })

  test('combines filters with AND', () => {
    expect(ids({ types: ['expense'], minCents: 100000 })).toEqual(['a'])
    expect(ids({ types: ['income'], search: 'netflix' })).toEqual([])
  })
})

describe('projectOccurrences', () => {
  const now = fromDateInput('2026-01-01')
  const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }

  test('a one-off card contributes exactly one date', () => {
    const one = card({ date: now + 5 * DAY, recurring: false })
    expect(projectOccurrences([one], now, now + 90 * DAY)).toHaveLength(1)
  })

  test('only the newest card in a series forecasts beyond itself', () => {
    // Two materialized occurrences of one series. If both projected forward,
    // February through April would each be counted twice.
    const first = card({
      _id: 'jan',
      date: fromDateInput('2026-01-01'),
      recurring: true,
      recurrence: rule,
      seriesId: 's1',
      seriesIndex: 0,
    })
    const second = card({
      _id: 'feb',
      date: fromDateInput('2026-02-01'),
      recurring: true,
      recurrence: rule,
      seriesId: 's1',
      seriesIndex: 1,
    })

    const dates = projectOccurrences([first, second], now, fromDateInput('2026-04-01')).map((o) =>
      toDateInput(o.date),
    )

    expect(dates.sort()).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
  })

  test('a series counts its end condition from the series origin', () => {
    // endsAfter 3 means Jan, Feb, Mar. A tail at index 1 must forecast only
    // March, not three more months.
    const capped: Recurrence = { ...rule, endsAfter: 3 }
    const tail = card({
      _id: 'feb',
      date: fromDateInput('2026-02-01'),
      recurring: true,
      recurrence: capped,
      seriesId: 's1',
      seriesIndex: 1,
    })

    const dates = projectOccurrences([tail], now, fromDateInput('2026-12-01')).map((o) =>
      toDateInput(o.date),
    )
    expect(dates).toEqual(['2026-02-01', '2026-03-01'])
  })
})

describe('cashFlowSeries', () => {
  const now = fromDateInput('2026-01-01')

  test('runs from zero and nets income against expenses', () => {
    const series = cashFlowSeries(
      [
        card({
          _id: 'in',
          type: 'income',
          status: 'expected',
          amountCents: 200000,
          date: now + DAY,
        }),
        card({ _id: 'out', amountCents: 50000, date: now + 2 * DAY }),
      ],
      10,
      now,
    )

    expect(series[0].balance).toBe(0)
    expect(series.at(-1)!.balance).toBe(150000)
    expect(series.at(-1)!.income).toBe(200000)
    expect(series.at(-1)!.expense).toBe(50000)
  })

  test('goes negative when expenses land before income', () => {
    const series = cashFlowSeries(
      [
        card({ _id: 'out', amountCents: 50000, date: now + DAY }),
        card({
          _id: 'in',
          type: 'income',
          status: 'expected',
          amountCents: 200000,
          date: now + 5 * DAY,
        }),
      ],
      10,
      now,
    )

    const trough = Math.min(...series.map((p) => p.balance))
    expect(trough).toBe(-50000)
  })
})

describe('outflowSeries', () => {
  const now = fromDateInput('2026-01-01')

  test('buckets by week on long horizons, clipping the tail to the horizon', () => {
    const series = outflowSeries([], 30, now)

    expect(series).toHaveLength(5)
    expect(series[1].start - series[0].start).toBe(7 * DAY)
    // 30 days is four whole weeks plus a 2-day remainder.
    expect(series.at(-1)!.start - series[0].start).toBe(28 * DAY)
  })

  test('falls back to one bar per day on short horizons', () => {
    const series = outflowSeries([], 7, now)

    expect(series).toHaveLength(7)
    expect(series[1].start - series[0].start).toBe(DAY)
  })

  test('sums each period separately rather than cumulatively', () => {
    const series = outflowSeries(
      [
        card({ _id: 'wk1', amountCents: 50000, date: now + DAY }),
        card({ _id: 'wk1b', amountCents: 25000, date: now + 3 * DAY }),
        card({ _id: 'wk2', amountCents: 10000, date: now + 8 * DAY }),
      ],
      30,
      now,
    )

    expect(series[0].expense).toBe(75000)
    expect(series[1].expense).toBe(10000)
    expect(series[2].expense).toBe(0)
  })

  test('splits income from expenses in the same bucket', () => {
    const series = outflowSeries(
      [
        card({
          _id: 'in',
          type: 'income',
          status: 'expected',
          amountCents: 300000,
          date: now + DAY,
        }),
        card({ _id: 'out', amountCents: 120000, date: now + 2 * DAY }),
      ],
      30,
      now,
    )

    expect(series[0].income).toBe(300000)
    expect(series[0].expense).toBe(120000)
  })

  test('counts a recurring card once per occurrence in its own bucket', () => {
    const series = outflowSeries(
      [
        card({
          _id: 'weekly',
          amountCents: 5000,
          date: now + DAY,
          recurring: true,
          recurrence: { frequency: 'weekly', interval: 1, weekday: new Date(now + DAY).getDay() },
        }),
      ],
      30,
      now,
    )

    expect(series[0].expense).toBe(5000)
    expect(series[1].expense).toBe(5000)
    expect(series[2].expense).toBe(5000)
  })

  test('ignores cards outside the horizon', () => {
    const series = outflowSeries(
      [card({ _id: 'far', amountCents: 9900, date: now + 90 * DAY })],
      30,
      now,
    )

    expect(series.every((b) => b.expense === 0)).toBe(true)
  })
})

describe('forecastByStatus', () => {
  const now = fromDateInput('2026-01-01')

  const biweekly: Recurrence = { frequency: 'weekly', interval: 2, weekday: 4 }

  test('counts occurrences the board has no cards for', () => {
    const forecasts = forecastByStatus(
      [
        card({
          _id: 'pay',
          type: 'income',
          status: 'expected',
          date: now + DAY,
          recurring: true,
          recurrence: biweekly,
          seriesId: 'pay',
          seriesIndex: 0,
        }),
      ],
      365,
      now,
    )

    const expected = forecasts.get('expected')!
    expect(expected.count).toBeGreaterThan(20)
    expect(expected.through).toBeGreaterThan(now + 300 * DAY)
  })

  test('only the furthest-out card in a series forecasts', () => {
    const series = [0, 14, 28].map((offset, i) =>
      card({
        _id: `pay_${i}`,
        type: 'income',
        status: 'expected',
        date: now + offset * DAY,
        recurring: true,
        recurrence: biweekly,
        seriesId: 'pay',
        seriesIndex: i,
      }),
    )

    const fromTailAlone = forecastByStatus([series[2]], 365, now).get('expected')!
    const fromWholeSeries = forecastByStatus(series, 365, now).get('expected')!

    // Counting from every materialized card would multiply the same dates.
    expect(fromWholeSeries.count).toBe(fromTailAlone.count)
  })

  test('reports nothing for one-off cards', () => {
    expect(forecastByStatus([card({ _id: 'once' })], 365, now).size).toBe(0)
  })

  test('reports nothing when the horizon is inside the materialized window', () => {
    const forecasts = forecastByStatus(
      [
        card({
          _id: 'rent',
          date: now + 40 * DAY,
          recurring: true,
          recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
          seriesId: 'rent',
          seriesIndex: 0,
        }),
      ],
      14,
      now,
    )

    expect(forecasts.size).toBe(0)
  })

  test('ignores completed cards', () => {
    const forecasts = forecastByStatus(
      [
        card({
          _id: 'paid',
          status: 'paid',
          date: now + DAY,
          recurring: true,
          recurrence: biweekly,
          seriesId: 'paid',
          seriesIndex: 0,
        }),
      ],
      365,
      now,
    )

    expect(forecasts.size).toBe(0)
  })
})
