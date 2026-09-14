import { isWithinEnd, occurrenceDate } from './recurrence'
import type { Doc } from './_generated/dataModel'
import type { Recurrence } from './recurrence'

export const EXPENSE_STATUSES = ['wishlist', 'upcoming', 'due', 'paid'] as const
export const INCOME_STATUSES = ['expected', 'received'] as const

export const COMPLETED_STATUSES = ['paid', 'received'] as const

export type CardDoc = Doc<'cards'>
export type CardRecurrence = Recurrence

export function isCompletedStatus(status: string) {
  return (COMPLETED_STATUSES as readonly string[]).includes(status)
}

export function isWishlistStatus(status: string) {
  return status === 'wishlist'
}

/**
 * Whether a card is money that is actually expected to move: open, and not
 * merely wished for. Every total, forecast, budget and alert filters on
 * this rather than on "not completed", which would quietly count the
 * wishlist.
 */
export function countsTowardBalance(status: string) {
  return !isCompletedStatus(status) && !isWishlistStatus(status)
}

export function statusesForType(type: 'income' | 'expense') {
  return type === 'expense' ? EXPENSE_STATUSES : INCOME_STATUSES
}

/** Default status a newly created card lands in. */
export function defaultStatus(type: 'income' | 'expense') {
  return type === 'expense' ? 'upcoming' : 'expected'
}

/**
 * A card's amount in whole cents.
 *
 * Cards written before the cents migration carry a float `amount` instead;
 * reading through here means one code path regardless of which column a
 * document happens to have. See `convex/migrations.ts`.
 */
export function cardCents(card: {
  amountCents?: number | undefined
  amount?: number | undefined
}): number {
  if (card.amountCents !== undefined) return card.amountCents
  if (card.amount !== undefined) return Math.round(card.amount * 100)
  return 0
}

/**
 * Identity of the caller, taken from the verified JWT rather than from an
 * argument. Every public function scopes its reads and writes by this — a
 * client-supplied user id would let anyone name someone else's board.
 */
export async function requireUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> }
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error('Not signed in')
  return identity.subject
}

/**
 * The identity of the caller, or `null` when signed out.
 *
 * Read queries use this rather than {@link requireUserId}: the board mounts
 * its queries unconditionally, so a query that throws on a missing identity
 * takes the whole component down the moment a token lapses — during a
 * refresh, on sign-out, or while auth is still settling on first paint.
 * Returning nothing is equally safe (no identity can only ever mean no data)
 * and lets the UI decide what to show. Mutations still throw: a write with no
 * caller is a real error, not an empty result.
 */
export async function getUserId(ctx: {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> }
}): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.subject ?? null
}

export type ProjectableCard = {
  _id: string
  date: number
  recurring: boolean
  recurrence?: Recurrence
  seriesId?: string
  seriesIndex?: number
  status: string
}

/**
 * Every date a set of cards lands on within `[now, horizonEnd]`, as
 * `{ card, date }` pairs.
 *
 * Recurring cards are materialized one at a time by the autoroll job, so a
 * series is usually part real rows and part forecast. Each real row
 * contributes its own date, and only the furthest-out row in a series
 * projects beyond itself — otherwise every materialized occurrence would
 * project the same future dates again and the forecast would multiply.
 *
 * Wishlist cards are skipped here, the one place nearly every total passes
 * through, so a wished-for purchase cannot leak into a forecast.
 */
export function projectOccurrences<T extends ProjectableCard>(
  cards: Array<T>,
  now: number,
  horizonEnd: number,
): Array<{ card: T; date: number }> {
  // The furthest-out materialized card in each series is the only one allowed
  // to forecast; a series of one behaves exactly like a one-off card.
  cards = cards.filter((card) => !isWishlistStatus(card.status))

  const seriesTail = new Map<string, T>()
  for (const card of cards) {
    if (!card.seriesId) continue
    const current = seriesTail.get(card.seriesId)
    if (!current || card.date > current.date) seriesTail.set(card.seriesId, card)
  }

  const results: Array<{ card: T; date: number }> = []

  for (const card of cards) {
    if (card.date <= horizonEnd) results.push({ card, date: card.date })

    if (!card.recurring || !card.recurrence) continue
    const isTail = !card.seriesId || seriesTail.get(card.seriesId)?._id === card._id
    if (!isTail) continue

    for (const date of forecastFrom(card, now, horizonEnd)) {
      results.push({ card, date })
    }
  }

  return results
}

/**
 * Dates a series' newest card implies but has not materialized yet, within
 * `[now, horizonEnd]`.
 *
 * Stored rules are normalized to be explicit (see `normalizeRecurrence`), so
 * stepping forward from this card's own date gives the same dates as counting
 * from the series' original anchor. End conditions are the exception: they
 * count occurrences from the origin, so they are checked against the card's
 * absolute `seriesIndex` plus the step.
 */
export function forecastFrom(card: ProjectableCard, from: number, to: number): Array<number> {
  if (!card.recurring || !card.recurrence || isWishlistStatus(card.status)) return []

  const baseIndex = card.seriesIndex ?? 0
  const dates: Array<number> = []

  for (let step = 1; step < MAX_FORECAST_STEPS; step++) {
    const date = occurrenceDate(card.date, card.recurrence, step)
    if (date === null || date > to) break
    if (!isWithinEnd(date, baseIndex + step, card.recurrence)) break
    if (date >= from) dates.push(date)
  }

  return dates
}

const MAX_FORECAST_STEPS = 1000
