import { describe, expect, it } from 'vitest'
import {
  LAST_DAY_OF_MONTH,
  LAST_WEEK_OF_MONTH,
  describeRecurrence,
  nextOccurrence,
  occurrenceAt,
  occurrencesInRange,
  totalOccurrences,
} from './recurrence'
import type { Recurrence } from './recurrence'

/** Local noon, matching how the app stores every card date. */
function at(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12).getTime()
}

function iso(ms: number | null) {
  if (ms === null) return null
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function series(anchor: number, recurrence: Recurrence, count: number) {
  return Array.from({ length: count }, (_, i) => iso(occurrenceAt(anchor, recurrence, i)))
}

describe('monthly by date', () => {
  it('keeps occurrence 0 on the card’s own date', () => {
    const anchor = at(2026, 1, 15)
    expect(iso(occurrenceAt(anchor, { frequency: 'monthly', interval: 1 }, 0))).toBe('2026-01-15')
  })

  it('does not drift after clamping to a short month', () => {
    // The bug this replaces: Jan 31 -> Feb 28 -> stuck on the 28th forever.
    const anchor = at(2026, 1, 31)
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 31 }
    expect(series(anchor, rule, 5)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
  })

  it('does not drift even when the rule omits dayOfMonth', () => {
    const anchor = at(2026, 1, 31)
    expect(series(anchor, { frequency: 'monthly', interval: 1 }, 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('handles a leap February', () => {
    const anchor = at(2028, 1, 30)
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 30 }
    expect(series(anchor, rule, 3)).toEqual(['2028-01-30', '2028-02-29', '2028-03-30'])
  })

  it('tracks the last day of each month', () => {
    const anchor = at(2026, 1, 31)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: LAST_DAY_OF_MONTH,
    }
    expect(series(anchor, rule, 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('honours an interval greater than one', () => {
    const anchor = at(2026, 1, 10)
    const rule: Recurrence = { frequency: 'monthly', interval: 3, dayOfMonth: 10 }
    expect(series(anchor, rule, 4)).toEqual([
      '2026-01-10',
      '2026-04-10',
      '2026-07-10',
      '2026-10-10',
    ])
  })
})

describe('monthly by nth weekday', () => {
  it('lands on the second Friday of each month', () => {
    const anchor = at(2026, 1, 9) // second Friday of January 2026
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      nthWeekday: { ordinal: 2, weekday: 5 },
    }
    expect(series(anchor, rule, 4)).toEqual([
      '2026-01-09',
      '2026-02-13',
      '2026-03-13',
      '2026-04-10',
    ])
  })

  it('lands on the last Monday of each month', () => {
    const anchor = at(2026, 1, 26)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      nthWeekday: { ordinal: LAST_WEEK_OF_MONTH, weekday: 1 },
    }
    expect(series(anchor, rule, 4)).toEqual([
      '2026-01-26',
      '2026-02-23',
      '2026-03-30',
      '2026-04-27',
    ])
  })

  it('falls back to the fourth when a month has no fifth', () => {
    const anchor = at(2026, 1, 30) // fifth Friday of January 2026
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      nthWeekday: { ordinal: 5, weekday: 5 },
    }
    // February 2026 has only four Fridays, so the rule clamps to the fourth.
    expect(iso(occurrenceAt(anchor, rule, 1))).toBe('2026-02-27')
  })

  it('takes precedence over dayOfMonth', () => {
    const anchor = at(2026, 1, 9)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      nthWeekday: { ordinal: 2, weekday: 5 },
    }
    expect(iso(occurrenceAt(anchor, rule, 1))).toBe('2026-02-13')
  })
})

describe('weekly', () => {
  it('repeats every week from the anchor', () => {
    const anchor = at(2026, 1, 7) // a Wednesday
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekday: 3 }
    expect(series(anchor, rule, 3)).toEqual(['2026-01-07', '2026-01-14', '2026-01-21'])
  })

  it('supports biweekly', () => {
    const anchor = at(2026, 1, 2) // a Friday
    const rule: Recurrence = { frequency: 'weekly', interval: 2, weekday: 5 }
    expect(series(anchor, rule, 4)).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
      '2026-02-13',
    ])
  })

  it('steps onto the rule’s weekday when the anchor is on another day', () => {
    const anchor = at(2026, 1, 7) // Wednesday, rule says Friday
    const rule: Recurrence = { frequency: 'weekly', interval: 1, weekday: 5 }
    expect(series(anchor, rule, 3)).toEqual(['2026-01-07', '2026-01-09', '2026-01-16'])
  })
})

describe('end conditions', () => {
  it('stops after a fixed number of occurrences', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      endsAfter: 4,
    }
    expect(series(anchor, rule, 5)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      null,
    ])
    expect(totalOccurrences(anchor, rule)).toBe(4)
  })

  it('stops on an end date, inclusive', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      endsOn: at(2026, 3, 1),
    }
    expect(series(anchor, rule, 4)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', null])
    expect(totalOccurrences(anchor, rule)).toBe(3)
  })

  it('applies whichever end condition comes first', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      endsAfter: 10,
      endsOn: at(2026, 2, 1),
    }
    expect(totalOccurrences(anchor, rule)).toBe(2)
  })

  it('reports an endless rule as undefined', () => {
    const anchor = at(2026, 1, 1)
    expect(totalOccurrences(anchor, { frequency: 'monthly', interval: 1 })).toBeUndefined()
  })

  it('returns no next occurrence once the rule has run out', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      endsAfter: 2,
    }
    expect(iso(nextOccurrence(anchor, rule))).toBe('2026-02-01')
    expect(nextOccurrence(anchor, rule, at(2026, 2, 1))).toBeNull()
  })
})

describe('occurrencesInRange', () => {
  it('returns just the date for a one-off card', () => {
    const anchor = at(2026, 1, 15)
    expect(occurrencesInRange(anchor, undefined, at(2026, 1, 1), at(2026, 3, 1))).toEqual([anchor])
  })

  it('drops a card dated past the end of the window', () => {
    const anchor = at(2026, 6, 1)
    expect(occurrencesInRange(anchor, undefined, at(2026, 1, 1), at(2026, 3, 1))).toEqual([])
  })

  it('includes an overdue anchor but does not back-fill missed occurrences', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 1 }
    const dates = occurrencesInRange(anchor, rule, at(2026, 3, 1), at(2026, 5, 1))
    // The anchor itself, then March/April/May — not February.
    expect(dates.map(iso)).toEqual(['2026-01-01', '2026-03-01', '2026-04-01', '2026-05-01'])
  })

  it('respects the rule’s end condition inside a longer window', () => {
    const anchor = at(2026, 1, 1)
    const rule: Recurrence = {
      frequency: 'monthly',
      interval: 1,
      dayOfMonth: 1,
      endsAfter: 3,
    }
    const dates = occurrencesInRange(anchor, rule, at(2026, 1, 1), at(2026, 12, 1))
    expect(dates.map(iso)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})

describe('describeRecurrence', () => {
  it('describes the common rules', () => {
    expect(describeRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 1 })).toBe(
      'Monthly on the 1st',
    )
    expect(describeRecurrence({ frequency: 'weekly', interval: 2, weekday: 5 })).toBe(
      'Every 2 weeks on Friday',
    )
    expect(
      describeRecurrence({
        frequency: 'monthly',
        interval: 1,
        nthWeekday: { ordinal: 2, weekday: 5 },
      }),
    ).toBe('Monthly on the second Friday')
    expect(
      describeRecurrence({
        frequency: 'monthly',
        interval: 1,
        nthWeekday: { ordinal: LAST_WEEK_OF_MONTH, weekday: 1 },
      }),
    ).toBe('Monthly on the last Monday')
    expect(
      describeRecurrence({
        frequency: 'monthly',
        interval: 1,
        dayOfMonth: LAST_DAY_OF_MONTH,
      }),
    ).toBe('Monthly on the last day')
  })

  it('mentions the end condition', () => {
    expect(
      describeRecurrence({
        frequency: 'monthly',
        interval: 1,
        dayOfMonth: 1,
        endsAfter: 4,
      }),
    ).toBe('Monthly on the 1st, 4 times')
  })
})
