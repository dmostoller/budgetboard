import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export const cardType = v.union(v.literal('income'), v.literal('expense'))

export const cardStatus = v.union(
  // expense lane
  v.literal('upcoming'),
  v.literal('due'),
  v.literal('paid'),
  // income lane
  v.literal('expected'),
  v.literal('received'),
)

export const cardPriority = v.union(v.literal('low'), v.literal('medium'), v.literal('high'))

export const recurrenceFrequency = v.union(v.literal('weekly'), v.literal('monthly'))

export const recurrence = v.object({
  frequency: recurrenceFrequency,
  // repeat every N weeks/months
  interval: v.number(),
  // weekly only, 0 (Sunday) - 6 (Saturday)
  weekday: v.optional(v.number()),
  // monthly only: 1-31 (clamped to short months), or -1 for the last day
  dayOfMonth: v.optional(v.number()),
  // monthly only: "the second Friday". Wins over dayOfMonth when both are set.
  nthWeekday: v.optional(
    v.object({
      // 1-4, or -1 for the last one in the month
      ordinal: v.number(),
      weekday: v.number(),
    }),
  ),
  // end conditions; either, both or neither
  endsAfter: v.optional(v.number()),
  endsOn: v.optional(v.number()),
})

export default defineSchema({
  cards: defineTable({
    userId: v.string(),
    type: cardType,
    /**
     * Money is stored in whole cents. `amount` is the legacy float column,
     * kept optional so documents written before the migration still validate;
     * `convex/migrations.ts:toCents` backfills it into `amountCents`. Always
     * read through `cardCents()` in `convex/lib.ts`, never either field
     * directly.
     */
    amountCents: v.optional(v.number()),
    amount: v.optional(v.number()),
    description: v.string(),
    // due date / expected date, epoch millis
    date: v.number(),
    category: v.string(),
    priority: cardPriority,
    recurring: v.boolean(),
    recurrence: v.optional(recurrence),
    /**
     * Groups every materialized occurrence of one recurring rule. The first
     * card in a series carries its own id here, so a series can always be
     * found from any of its cards. Absent on one-off cards.
     */
    seriesId: v.optional(v.string()),
    /**
     * 0-based position of this card within its series, which is what the
     * recurrence engine's end conditions count.
     */
    seriesIndex: v.optional(v.number()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: cardStatus,
    // sort position within a column, ascending
    order: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    /**
     * Set when a completed card is rolled into a closed month. Archived cards
     * stay queryable for history but leave the board and the live queries.
     */
    archivedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_user_status', ['userId', 'status'])
    .index('by_user_date', ['userId', 'date'])
    .index('by_user_archived', ['userId', 'archivedAt'])
    .index('by_series', ['seriesId']),

  categories: defineTable({
    userId: v.string(),
    name: v.string(),
    type: cardType,
  }).index('by_user', ['userId']),

  /** A monthly spending cap for one expense category. */
  budgets: defineTable({
    userId: v.string(),
    category: v.string(),
    limitCents: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_category', ['userId', 'category']),

  settings: defineTable({
    userId: v.string(),
    horizonDays: v.number(),
    showCompleted: v.boolean(),
    // ISO 4217, e.g. "USD" / "EUR"
    currency: v.optional(v.string()),
    locale: v.optional(v.string()),
    // opt out of the weekly assistant briefing
    insightsEnabled: v.optional(v.boolean()),
  }).index('by_user', ['userId']),

  /**
   * Alert dismissals live server-side so silencing a bill on a laptop also
   * silences it on a phone. The id folds in the card's date and status, so a
   * bill that slips speaks up again under a new id.
   */
  alertDismissals: defineTable({
    userId: v.string(),
    alertId: v.string(),
    dismissedAt: v.number(),
  })
    .index('by_user', ['userId'])
    .index('by_user_alert', ['userId', 'alertId']),

  /**
   * TanStack AI's `ChatPersistedState` blob, one row per thread. Stored
   * opaquely: the shape belongs to the chat client, not to this schema.
   */
  chatThreads: defineTable({
    userId: v.string(),
    threadId: v.string(),
    state: v.any(),
    updatedAt: v.number(),
  }).index('by_user_thread', ['userId', 'threadId']),

  /** Observations the assistant volunteers without being asked. */
  insights: defineTable({
    userId: v.string(),
    headline: v.string(),
    detail: v.string(),
    // cards the observation is about, for deep-linking from the UI
    cardIds: v.array(v.string()),
    createdAt: v.number(),
    dismissedAt: v.optional(v.number()),
  }).index('by_user', ['userId']),
})
