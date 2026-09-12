/**
 * The one recurrence engine. Imported by the Convex functions, the React UI
 * and the AI tools so a rule can never mean two different things in two
 * places.
 *
 * Every occurrence is addressed by an integer index measured from the card's
 * own date (index 0 is always that date, exactly as stored). Occurrence N is
 * computed directly from the anchor rather than by stepping forward from
 * occurrence N-1, which is what keeps a "monthly on the 31st" rule from
 * collapsing onto the 28th the first time it passes February.
 */

export type RecurrenceFrequency = 'weekly' | 'monthly'

/** Resolve a monthly rule against a weekday instead of a date. */
export interface NthWeekday {
  /** 1-4 for "first".."fourth", or -1 for "last". */
  ordinal: number
  /** 0 (Sunday) - 6 (Saturday). */
  weekday: number
}

export interface Recurrence {
  frequency: RecurrenceFrequency
  /** Repeat every N weeks/months. */
  interval: number
  /** Weekly only, 0 (Sunday) - 6 (Saturday). */
  weekday?: number
  /** Monthly by date: 1-31, clamped to short months, or -1 for the last day. */
  dayOfMonth?: number
  /** Monthly by weekday: "the second Friday". Takes precedence over dayOfMonth. */
  nthWeekday?: NthWeekday
  /** Stop after this many occurrences in total, counting the card's own date. */
  endsAfter?: number
  /** Stop once occurrences pass this date (inclusive), epoch millis. */
  endsOn?: number
}

/** Sentinel `dayOfMonth` meaning "whatever the last day of that month is". */
export const LAST_DAY_OF_MONTH = -1

/** Sentinel `nthWeekday.ordinal` meaning "the last one in the month". */
export const LAST_WEEK_OF_MONTH = -1

/** Guard against a pathological rule spinning forever. */
const MAX_OCCURRENCES = 1000

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [LAST_WEEK_OF_MONTH]: 'last',
}

/**
 * Occurrences are pinned to local noon so a DST shift can never round a date
 * onto the previous or next day.
 */
function atNoon(year: number, month: number, day: number) {
  return new Date(year, month, day, 12, 0, 0, 0).getTime()
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

/** The date the nth given weekday falls on in a specific month. */
function nthWeekdayOfMonth(year: number, month: number, { ordinal, weekday }: NthWeekday) {
  const total = daysInMonth(year, month)

  if (ordinal <= LAST_WEEK_OF_MONTH) {
    const lastWeekday = new Date(year, month, total).getDay()
    const back = (lastWeekday - weekday + 7) % 7
    return atNoon(year, month, total - back)
  }

  const firstWeekday = new Date(year, month, 1).getDay()
  const forward = (weekday - firstWeekday + 7) % 7
  const day = 1 + forward + (Math.max(1, ordinal) - 1) * 7
  // "Fifth Tuesday" in a month that has only four falls back to the fourth,
  // which is the same clamping users expect from "the 31st" in February.
  return atNoon(year, month, day > total ? day - 7 : day)
}

/**
 * The date `step` occurrences after `anchor`, with no regard for the rule's
 * end conditions. Step 0 is the anchor itself.
 *
 * Kept separate from {@link occurrenceAt} because a series that has been
 * partly materialized forecasts from its newest real card while still
 * counting `endsAfter` from the series' origin — two different indices, one
 * piece of date arithmetic.
 */
export function occurrenceDate(
  anchor: number,
  recurrence: Recurrence | undefined,
  step: number,
): number | null {
  if (step < 0) return null
  if (!recurrence) return step === 0 ? anchor : null
  if (step === 0) return anchor

  const index = step
  const interval = Math.max(1, Math.floor(recurrence.interval) || 1)
  const from = new Date(anchor)

  if (recurrence.frequency === 'weekly') {
    const target = recurrence.weekday ?? from.getDay()
    // Step onto the rule's weekday first, then out by whole intervals, so a
    // card dated Wednesday under a "weekly on Friday" rule lands on Fridays.
    // When the anchor is already on the target weekday that first step is
    // free, and occurrence N is simply N intervals out.
    const drift = (target - from.getDay() + 7) % 7
    const weeksOut = drift === 0 ? index : index - 1
    const next = new Date(anchor)
    next.setDate(next.getDate() + drift + weeksOut * interval * 7)
    next.setHours(12, 0, 0, 0)
    return next.getTime()
  }

  const year = from.getFullYear()
  const month = from.getMonth() + index * interval

  if (recurrence.nthWeekday) {
    const normalized = new Date(year, month, 1)
    return nthWeekdayOfMonth(normalized.getFullYear(), normalized.getMonth(), recurrence.nthWeekday)
  }

  const normalized = new Date(year, month, 1)
  const y = normalized.getFullYear()
  const m = normalized.getMonth()
  const total = daysInMonth(y, m)
  const requested = recurrence.dayOfMonth ?? from.getDate()
  const day = requested === LAST_DAY_OF_MONTH ? total : Math.min(requested, total)
  return atNoon(y, m, day)
}

/**
 * Whether the occurrence at absolute series index `index`, landing on `date`,
 * still falls inside the rule's end conditions.
 */
export function isWithinEnd(date: number, index: number, recurrence: Recurrence | undefined) {
  if (!recurrence) return index === 0
  if (recurrence.endsAfter !== undefined && index >= recurrence.endsAfter) return false
  if (recurrence.endsOn !== undefined && date > recurrence.endsOn) return false
  return true
}

/**
 * The date of occurrence `index`, counting the card's own date as 0, or
 * `null` once the rule's end condition has been passed.
 */
export function occurrenceAt(
  anchor: number,
  recurrence: Recurrence | undefined,
  index: number,
): number | null {
  const date = occurrenceDate(anchor, recurrence, index)
  if (date === null) return null
  return isWithinEnd(date, index, recurrence) ? date : null
}

/** How many occurrences a rule produces in total, or `undefined` if endless. */
export function totalOccurrences(
  anchor: number,
  recurrence: Recurrence | undefined,
): number | undefined {
  if (!recurrence) return 1
  if (recurrence.endsAfter === undefined && recurrence.endsOn === undefined) return undefined

  let count = 0
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    if (occurrenceAt(anchor, recurrence, i) === null) break
    count++
  }
  return count
}

/**
 * The next date strictly after `after` that this rule lands on, or `null` if
 * the rule has run out. `after` defaults to the anchor, giving "the one that
 * follows this card".
 */
export function nextOccurrence(
  anchor: number,
  recurrence: Recurrence | undefined,
  after: number = anchor,
): number | null {
  if (!recurrence) return null
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const date = occurrenceAt(anchor, recurrence, i)
    if (date === null) return null
    if (date > after) return date
  }
  return null
}

/** The 0-based index of an occurrence date, or `null` if it isn't one. */
export function occurrenceIndexOf(
  anchor: number,
  recurrence: Recurrence | undefined,
  date: number,
): number | null {
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const at = occurrenceAt(anchor, recurrence, i)
    if (at === null) return null
    if (at === date) return i
    if (at > date) return null
  }
  return null
}

/**
 * Every date in `[from, to]` this rule lands on. The anchor is always
 * included when it falls inside the window — including when it is overdue —
 * but occurrences that slipped by before `from` are not back-filled as a
 * missed backlog.
 */
export function occurrencesInRange(
  anchor: number,
  recurrence: Recurrence | undefined,
  from: number,
  to: number,
): Array<number> {
  if (anchor > to) return []
  if (!recurrence) return [anchor]

  const dates: Array<number> = [anchor]
  for (let i = 1; i < MAX_OCCURRENCES; i++) {
    const date = occurrenceAt(anchor, recurrence, i)
    if (date === null || date > to) break
    if (date >= from) dates.push(date)
  }
  return dates
}

function ordinalDay(n: number) {
  if (n === LAST_DAY_OF_MONTH) return 'last day'
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function describeEnd(recurrence: Recurrence) {
  const parts: Array<string> = []
  if (recurrence.endsAfter !== undefined) {
    parts.push(`${recurrence.endsAfter} time${recurrence.endsAfter === 1 ? '' : 's'}`)
  }
  if (recurrence.endsOn !== undefined) {
    parts.push(
      `until ${new Date(recurrence.endsOn).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
    )
  }
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/** Human-readable summary, e.g. "Every 2 months on the second Friday, 4 times". */
export function describeRecurrence(recurrence: Recurrence): string {
  const { interval } = recurrence
  const end = describeEnd(recurrence)

  if (recurrence.frequency === 'weekly') {
    const weekday = WEEKDAYS[recurrence.weekday ?? 0]
    return interval === 1
      ? `Weekly on ${weekday}${end}`
      : `Every ${interval} weeks on ${weekday}${end}`
  }

  const when = recurrence.nthWeekday
    ? `the ${ORDINALS[recurrence.nthWeekday.ordinal] ?? `${recurrence.nthWeekday.ordinal}th`} ${
        WEEKDAYS[recurrence.nthWeekday.weekday]
      }`
    : `the ${ordinalDay(recurrence.dayOfMonth ?? 1)}`

  return interval === 1 ? `Monthly on ${when}${end}` : `Every ${interval} months on ${when}${end}`
}

/**
 * Fill in whichever field the rule left implicit, using the card's own date.
 *
 * Stored rules are always explicit. An implicit rule ("monthly", no day) has
 * to be resolved against whatever date it is evaluated from, which is exactly
 * how a series drifts once a short month clamps it. Normalizing on write
 * means a rule means the same thing no matter which occurrence it is read
 * from — which in turn is what makes it safe for a partly-materialized series
 * to forecast from its newest card instead of its original anchor.
 */
export function normalizeRecurrence(recurrence: Recurrence, anchor: number): Recurrence {
  const from = new Date(anchor)
  const interval = Math.max(1, Math.floor(recurrence.interval) || 1)

  if (recurrence.frequency === 'weekly') {
    return {
      frequency: 'weekly',
      interval,
      weekday: recurrence.weekday ?? from.getDay(),
      ...(recurrence.endsAfter !== undefined ? { endsAfter: recurrence.endsAfter } : {}),
      ...(recurrence.endsOn !== undefined ? { endsOn: recurrence.endsOn } : {}),
    }
  }

  return {
    frequency: 'monthly',
    interval,
    ...(recurrence.nthWeekday
      ? { nthWeekday: recurrence.nthWeekday }
      : { dayOfMonth: recurrence.dayOfMonth ?? from.getDate() }),
    ...(recurrence.endsAfter !== undefined ? { endsAfter: recurrence.endsAfter } : {}),
    ...(recurrence.endsOn !== undefined ? { endsOn: recurrence.endsOn } : {}),
  }
}
