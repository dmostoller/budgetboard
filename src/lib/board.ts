/**
 * Shared board vocabulary used by the UI, the AI tools and the Convex layer.
 *
 * The recurrence maths and the money/series helpers live in `convex/` and are
 * re-exported here rather than reimplemented: a rule that means one thing on
 * the server and another in a chart is the bug this arrangement exists to
 * prevent.
 */

export {
  LAST_DAY_OF_MONTH,
  LAST_WEEK_OF_MONTH,
  WEEKDAYS,
  describeRecurrence,
  isWithinEnd,
  nextOccurrence,
  normalizeRecurrence,
  occurrenceAt,
  occurrenceDate,
  occurrencesInRange,
  totalOccurrences,
} from '../../convex/recurrence'
export type { NthWeekday, Recurrence, RecurrenceFrequency } from '../../convex/recurrence'

export {
  cardCents,
  countsTowardBalance,
  forecastFrom,
  isWishlistStatus,
  projectOccurrences,
} from '../../convex/lib'

import {
  cardCents,
  countsTowardBalance,
  forecastFrom,
  isWishlistStatus,
  projectOccurrences,
} from '../../convex/lib'
import type { Recurrence } from '../../convex/recurrence'

export const DAY = 24 * 60 * 60 * 1000

export type CardType = 'income' | 'expense'
export type CardStatus = 'wishlist' | 'upcoming' | 'due' | 'paid' | 'expected' | 'received'
export type CardPriority = 'low' | 'medium' | 'high'

export interface Card {
  _id: string
  _creationTime: number
  userId: string
  type: CardType
  /** Whole cents. Read it through `cardCents` — older rows carry `amount`. */
  amountCents?: number
  /** Legacy float dollars, pre-migration. */
  amount?: number
  description: string
  date: number
  category: string
  priority: CardPriority
  recurring: boolean
  recurrence?: Recurrence
  seriesId?: string
  seriesIndex?: number
  source?: string
  notes?: string
  status: CardStatus
  order: number
  createdAt: number
  completedAt?: number
  archivedAt?: number
}

export interface Lane {
  key: 'expense' | 'income' | 'wishlist'
  type: CardType
  title: string
  columns: Array<{ status: CardStatus; title: string }>
}

/**
 * Lanes in board order. The wishlist is an expense status but gets a lane of
 * its own: it is not part of the upcoming → due → paid flow, and on wide
 * screens it shares a row with income (see `BoardLanes`).
 */
export const LANES: Array<Lane> = [
  {
    key: 'expense',
    type: 'expense',
    title: 'Expenses',
    columns: [
      { status: 'upcoming', title: 'Upcoming' },
      { status: 'due', title: 'Due' },
      { status: 'paid', title: 'Paid' },
    ],
  },
  {
    key: 'income',
    type: 'income',
    title: 'Income',
    columns: [
      { status: 'expected', title: 'Expected' },
      { status: 'received', title: 'Received' },
    ],
  },
  {
    key: 'wishlist',
    type: 'expense',
    title: 'Wishlist',
    columns: [{ status: 'wishlist', title: 'Wishlist' }],
  },
]

/** Every column a card of this type may sit in, across lanes. */
export function columnsForType(type: CardType) {
  return LANES.filter((lane) => lane.type === type).flatMap((lane) => lane.columns)
}

/** The column a new card of this type lands in unless told otherwise. */
export function defaultStatusFor(type: CardType): CardStatus {
  return type === 'expense' ? 'upcoming' : 'expected'
}

/** How far out a new wishlist card's "want by" date starts. */
export const WISHLIST_DEFAULT_DAYS = 90

export const COMPLETED_STATUSES: Array<CardStatus> = ['paid', 'received']

export function isCompleted(status: CardStatus) {
  return COMPLETED_STATUSES.includes(status)
}

export function statusLabel(status: CardStatus) {
  for (const lane of LANES) {
    const column = lane.columns.find((c) => c.status === status)
    if (column) return column.title
  }
  return status
}

export function typeForStatus(status: CardStatus): CardType {
  return status === 'expected' || status === 'received' ? 'income' : 'expense'
}

export const HORIZON_OPTIONS = [
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 60, label: '2 months' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
]

export const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British pound (£)' },
  { code: 'CAD', label: 'Canadian dollar (C$)' },
  { code: 'AUD', label: 'Australian dollar (A$)' },
  { code: 'JPY', label: 'Japanese yen (¥)' },
  { code: 'INR', label: 'Indian rupee (₹)' },
]

export interface MoneyFormat {
  currency: string
  locale: string
}

export const DEFAULT_MONEY: MoneyFormat = { currency: 'USD', locale: 'en-US' }

/**
 * Format whole cents as money. Amounts are integers end to end — floats drift
 * once you start summing a year of them.
 */
export function formatCents(cents: number, format: MoneyFormat = DEFAULT_MONEY) {
  return new Intl.NumberFormat(format.locale, {
    style: 'currency',
    currency: format.currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/** Parse a user-typed amount ("12", "12.5", "1,200.55") into whole cents. */
export function toCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)
  const cleaned = value.replace(/[^0-9.-]/g, '')
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
}

/** Cents back to the decimal string an `<input type="number">` expects. */
export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

/** Local-date `YYYY-MM-DD` string, for `<input type="date">`. */
export function toDateInput(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse a `YYYY-MM-DD` string as local noon, avoiding timezone drift. */
export function fromDateInput(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

export type DateUrgency = 'overdue' | 'due-soon' | 'later' | 'done'

export function urgency(card: Card, now = Date.now()): DateUrgency {
  if (isCompleted(card.status)) return 'done'
  // A wishlist date is a hope, not a deadline; it is never overdue.
  if (isWishlistStatus(card.status)) return 'later'
  if (card.date < now) return 'overdue'
  if (card.date <= now + 7 * DAY) return 'due-soon'
  return 'later'
}

export function relativeDue(ms: number, now = Date.now()) {
  const days = Math.round((ms - now) / DAY)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days < 30) return `in ${days} days`
  return formatDate(ms)
}

/**
 * Filters the board's search bar applies. Every field is optional and they
 * combine with AND, which is how people expect a filter row to behave.
 */
export interface BoardFilters {
  search?: string
  categories?: Array<string>
  types?: Array<CardType>
  priorities?: Array<CardPriority>
  recurringOnly?: boolean
  minCents?: number
  maxCents?: number
}

export const EMPTY_FILTERS: BoardFilters = {}

export function hasActiveFilters(filters: BoardFilters) {
  return Boolean(
    filters.search?.trim() ||
    filters.categories?.length ||
    filters.types?.length ||
    filters.priorities?.length ||
    filters.recurringOnly ||
    filters.minCents !== undefined ||
    filters.maxCents !== undefined,
  )
}

/** Apply the search bar's filters to a list of cards. Pure, so it is tested. */
export function filterBoardCards<T extends Card>(cards: Array<T>, filters: BoardFilters): Array<T> {
  const search = filters.search?.trim().toLowerCase()
  const typeSet = filters.types?.length ? new Set(filters.types) : undefined
  const prioritySet = filters.priorities?.length ? new Set(filters.priorities) : undefined
  const categorySet = filters.categories?.length ? new Set(filters.categories) : undefined

  return cards.filter((card) => {
    if (typeSet && !typeSet.has(card.type)) return false
    if (prioritySet && !prioritySet.has(card.priority)) return false
    if (categorySet && !categorySet.has(card.category)) return false
    if (filters.recurringOnly && !card.recurring) return false

    const cents = cardCents(card)
    if (filters.minCents !== undefined && cents < filters.minCents) return false
    if (filters.maxCents !== undefined && cents > filters.maxCents) return false

    if (search) {
      const haystack =
        `${card.description} ${card.source ?? ''} ${card.category} ${card.notes ?? ''}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }

    return true
  })
}

/**
 * Net cash flow per day across the horizon, as a running balance starting
 * from zero.
 *
 * Zero is the deliberate baseline: this chart answers "does what comes in
 * cover what goes out over this window", not "what will my account say".
 */
/** Midnight today, the left edge of every horizon window. */
function horizonStart(now: number) {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

/**
 * Money landing on each day of the window, keyed by `YYYY-MM-DD`.
 *
 * Completed cards are single realized points; open ones project their series
 * forward across the window.
 */
function dailyTotals(cards: Array<Card>, from: number, to: number) {
  const income = new Map<string, number>()
  const expense = new Map<string, number>()

  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value)

  for (const card of cards.filter((c) => isCompleted(c.status))) {
    if (card.date < from || card.date > to) continue
    add(card.type === 'income' ? income : expense, toDateInput(card.date), cardCents(card))
  }

  const open = cards.filter((c) => countsTowardBalance(c.status))
  for (const { card, date } of projectOccurrences(open, from, to)) {
    if (date < from || date > to) continue
    add(card.type === 'income' ? income : expense, toDateInput(date), cardCents(card))
  }

  return { income, expense }
}

export function cashFlowSeries(cards: Array<Card>, horizonDays: number, now = Date.now()) {
  const from = horizonStart(now)
  const to = from + horizonDays * DAY

  const { income: incomeByDay, expense: expenseByDay } = dailyTotals(cards, from, to)

  let balance = 0
  let income = 0
  let expense = 0

  return Array.from({ length: horizonDays + 1 }, (_, i) => {
    const date = from + i * DAY
    const key = toDateInput(date)
    balance += (incomeByDay.get(key) ?? 0) - (expenseByDay.get(key) ?? 0)
    income += incomeByDay.get(key) ?? 0
    expense += expenseByDay.get(key) ?? 0
    return {
      date,
      label: formatDate(date),
      balance,
      income,
      expense,
    }
  })
}

export interface OutflowBucket {
  /** Midnight at the bucket's first day. */
  start: number
  label: string
  income: number
  expense: number
}

/**
 * Money in and out per period across the horizon, as discrete buckets rather
 * than a running total.
 *
 * `cashFlowSeries` is cumulative, which deliberately smooths timing: a week
 * where rent, insurance and a card payment all land together reads as a gentle
 * slope. This answers the other question — which period actually gets squeezed.
 *
 * Buckets are weekly, except on short horizons where a week or two of bars
 * says nothing; below `DAILY_BUCKET_CUTOFF_DAYS` it falls back to one bar
 * per day. The final bucket is clipped to the end of the horizon, so a 30-day
 * window ends in a 2-day bucket rather than running 5 days past the edge.
 */
export const DAILY_BUCKET_CUTOFF_DAYS = 14

export function outflowSeries(
  cards: Array<Card>,
  horizonDays: number,
  now = Date.now(),
): Array<OutflowBucket> {
  const from = horizonStart(now)
  const to = from + horizonDays * DAY
  const { income, expense } = dailyTotals(cards, from, to)

  const bucketDays = horizonDays <= DAILY_BUCKET_CUTOFF_DAYS ? 1 : 7
  const bucketCount = Math.ceil(horizonDays / bucketDays)

  return Array.from({ length: bucketCount }, (_, i) => {
    const start = from + i * bucketDays * DAY
    // Clip the tail bucket so it never reaches past the horizon.
    const days = Math.min(bucketDays, horizonDays - i * bucketDays)

    let bucketIncome = 0
    let bucketExpense = 0
    for (let d = 0; d < days; d++) {
      const key = toDateInput(start + d * DAY)
      bucketIncome += income.get(key) ?? 0
      bucketExpense += expense.get(key) ?? 0
    }

    return { start, label: formatDate(start), income: bucketIncome, expense: bucketExpense }
  })
}

export interface ColumnForecast {
  /** Occurrences implied within the horizon but not materialized as cards. */
  count: number
  /** Date of the furthest-out one, for "…through Sep 2027". */
  through: number
}

/**
 * What each column's recurring series imply beyond the cards that exist.
 *
 * The autoroll job only materializes a series a fixed window ahead
 * (`rollAheadDays` in `convex/cards.ts`), while the charts forecast the full
 * horizon — so a year-long horizon shows a year of paychecks in the chart and
 * three of them on the board. This is what lets a column say so out loud
 * rather than leaving the gap to be discovered.
 *
 * Only a series' furthest-out card forecasts, matching `projectOccurrences`;
 * counting from every materialized occurrence would multiply the same future
 * dates.
 */
export function forecastByStatus(
  cards: Array<Card>,
  horizonDays: number,
  now = Date.now(),
): Map<CardStatus, ColumnForecast> {
  const from = horizonStart(now)
  const to = from + horizonDays * DAY

  const open = cards.filter((c) => countsTowardBalance(c.status))

  const seriesTail = new Map<string, Card>()
  for (const card of open) {
    if (!card.seriesId) continue
    const current = seriesTail.get(card.seriesId)
    if (!current || card.date > current.date) seriesTail.set(card.seriesId, card)
  }

  const byStatus = new Map<CardStatus, ColumnForecast>()

  for (const card of open) {
    const isTail = !card.seriesId || seriesTail.get(card.seriesId)?._id === card._id
    if (!isTail) continue

    const dates = forecastFrom(card, from, to)
    if (dates.length === 0) continue

    const current = byStatus.get(card.status) ?? { count: 0, through: 0 }
    byStatus.set(card.status, {
      count: current.count + dates.length,
      through: Math.max(current.through, dates.at(-1) ?? 0),
    })
  }

  return byStatus
}
