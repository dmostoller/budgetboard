import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vite-plus/test'
import schema from './schema'
import { api, internal } from './_generated/api'
import { ROLL_AHEAD_MAX_DAYS, ROLL_AHEAD_MIN_DAYS, rollAheadDays } from './cards'

const DAY = 24 * 60 * 60 * 1000
const USER = { subject: 'user_1', issuer: 'test', tokenIdentifier: 'test|user_1' }
const OTHER = { subject: 'user_2', issuer: 'test', tokenIdentifier: 'test|user_2' }

const modules = import.meta.glob('./**/*.*s')

function setup() {
  return convexTest(schema, modules)
}

/** A signed-in caller. Every public function derives its user id from this. */
function as(t: ReturnType<typeof setup>, identity = USER) {
  return t.withIdentity(identity)
}

function expenseArgs(overrides: Record<string, unknown> = {}) {
  return {
    type: 'expense' as const,
    amountCents: 120000,
    description: 'Rent',
    date: Date.now() + 5 * DAY,
    category: 'Rent/Mortgage',
    ...overrides,
  }
}

describe('authorization', () => {
  test('reads return nothing when signed out, rather than throwing', async () => {
    const t = setup()
    // A board mounts its queries before auth has necessarily settled, so an
    // unauthenticated read has to be an empty result and not an exception —
    // otherwise a lapsed token takes the whole component down.
    expect(await t.query(api.cards.list, {})).toEqual([])
    expect(await t.query(api.cards.listArchived, {})).toEqual([])
    expect(await t.query(api.budgets.list, {})).toEqual([])
    expect(await t.query(api.insights.list, {})).toEqual([])
    expect((await t.query(api.budgets.progress, {})).budgets).toEqual([])

    const stats = await t.query(api.cards.stats, {})
    expect(stats).toMatchObject({ upcomingExpenses: 0, expectedIncome: 0, totalCards: 0 })
  })

  test('a signed-out read cannot see an existing user’s data', async () => {
    const t = setup()
    await as(t).mutation(api.cards.create, expenseArgs())

    // Empty, not "everyone's".
    expect(await t.query(api.cards.list, {})).toEqual([])
    expect((await t.query(api.cards.stats, {})).totalCards).toBe(0)
  })

  test('writes still refuse when signed out', async () => {
    const t = setup()
    await expect(t.mutation(api.cards.create, expenseArgs())).rejects.toThrow(/not signed in/i)
    await expect(
      t.mutation(api.budgets.set, { category: 'Groceries', limitCents: 1000 }),
    ).rejects.toThrow(/not signed in/i)
    await expect(t.mutation(api.categories.add, { name: 'X', type: 'expense' })).rejects.toThrow(
      /not signed in/i,
    )
  })

  test('one user cannot read or write another user’s card', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs())

    // The id is guessable in principle; ownership is what stops the access.
    expect(await as(t, OTHER).query(api.cards.get, { id })).toBeNull()
    await expect(
      as(t, OTHER).mutation(api.cards.update, { id, description: 'Hacked' }),
    ).rejects.toThrow(/not found/i)
    await expect(as(t, OTHER).mutation(api.cards.remove, { id })).rejects.toThrow(/not found/i)
    await expect(as(t, OTHER).mutation(api.cards.move, { id, status: 'paid' })).rejects.toThrow(
      /not found/i,
    )
  })

  test('a board only ever lists its own owner’s cards', async () => {
    const t = setup()
    await as(t).mutation(api.cards.create, expenseArgs({ description: 'Mine' }))
    await as(t, OTHER).mutation(api.cards.create, expenseArgs({ description: 'Theirs' }))

    const mine = await as(t).query(api.cards.list, {})
    expect(mine.map((c) => c.description)).toEqual(['Mine'])
  })
})

describe('cards.create', () => {
  test('defaults a new expense into the upcoming column', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs())
    const card = await as(t).query(api.cards.get, { id })

    expect(card).toMatchObject({
      status: 'upcoming',
      priority: 'medium',
      recurring: false,
      amountCents: 120000,
    })
    expect(card?.completedAt).toBeUndefined()
  })

  test('defaults a new income card into the expected column', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({ type: 'income', category: 'Salary', description: 'Payday' }),
    )
    const card = await as(t).query(api.cards.get, { id })
    expect(card?.status).toBe('expected')
  })

  test('stamps completedAt when a card starts out paid', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs({ status: 'paid' }))
    const card = await as(t).query(api.cards.get, { id })
    expect(card?.completedAt).toEqual(expect.any(Number))
  })

  test('rejects a status from the wrong lane', async () => {
    const t = setup()
    await expect(
      as(t).mutation(api.cards.create, expenseArgs({ status: 'received' })),
    ).rejects.toThrow(/not valid for a expense card/)
  })

  test('rejects a negative amount', async () => {
    const t = setup()
    await expect(
      as(t).mutation(api.cards.create, expenseArgs({ amountCents: -1 })),
    ).rejects.toThrow(/positive/)
  })

  test('normalizes an implicit recurrence rule against the card’s date', async () => {
    const t = setup()
    const date = new Date(2026, 0, 31, 12).getTime()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        // No dayOfMonth: the rule would otherwise resolve differently every
        // time it was read, which is how a series drifts off the 31st.
        recurrence: { frequency: 'monthly', interval: 1 },
      }),
    )

    const card = await as(t).query(api.cards.get, { id })
    expect(card?.recurrence).toMatchObject({ frequency: 'monthly', interval: 1, dayOfMonth: 31 })
  })

  test('gives a recurring card a series identity', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      }),
    )
    const card = await as(t).query(api.cards.get, { id })
    expect(card?.seriesId).toBe(id)
    expect(card?.seriesIndex).toBe(0)
  })
})

describe('cards.move', () => {
  test('returns the previous position so the move can be undone', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs())
    const before = await as(t).query(api.cards.get, { id })

    const result = await as(t).mutation(api.cards.move, { id, status: 'due' })

    expect(result.previous).toEqual({ status: 'upcoming', order: before!.order })
  })

  test('rejects a move into the other lane', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs())
    await expect(as(t).mutation(api.cards.move, { id, status: 'received' })).rejects.toThrow(
      /not valid for a expense card/,
    )
  })

  test('completing a card stamps completedAt, and un-completing clears it', async () => {
    const t = setup()
    const id = await as(t).mutation(api.cards.create, expenseArgs())

    await as(t).mutation(api.cards.move, { id, status: 'paid' })
    expect((await as(t).query(api.cards.get, { id }))?.completedAt).toEqual(expect.any(Number))

    await as(t).mutation(api.cards.move, { id, status: 'upcoming' })
    expect((await as(t).query(api.cards.get, { id }))?.completedAt).toBeUndefined()
  })
})

describe('recurring series', () => {
  test('completing an occurrence materializes the next one', async () => {
    const t = setup()
    const date = new Date(2026, 0, 1, 12).getTime()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      }),
    )

    await as(t).mutation(api.cards.move, { id, status: 'paid' })

    const cards = await as(t).query(api.cards.list, {})
    expect(cards).toHaveLength(2)

    const next = cards.find((c) => c._id !== id)!
    expect(next.status).toBe('upcoming')
    expect(next.seriesId).toBe(id)
    expect(next.seriesIndex).toBe(1)
    expect(new Date(next.date).getMonth()).toBe(1)
  })

  test('does not roll a series twice for the same occurrence', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      }),
    )

    await as(t).mutation(api.cards.move, { id, status: 'paid' })
    // Re-completing an already-completed card must not produce a duplicate.
    await as(t).mutation(api.cards.move, { id, status: 'paid' })
    await as(t).mutation(internal.cards.rollAllSeries, {})

    const cards = await as(t).query(api.cards.list, {})
    const indexes = cards.map((c) => c.seriesIndex ?? 0).sort((a, b) => a - b)
    expect(indexes).toEqual([0, 1])
  })

  test('stops rolling once the rule’s end condition is reached', async () => {
    const t = setup()
    const date = new Date(2026, 0, 1, 12).getTime()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        // Two occurrences in total: this card, and one more.
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1, endsAfter: 2 },
      }),
    )

    await as(t).mutation(api.cards.move, { id, status: 'paid' })
    const afterFirst = await as(t).query(api.cards.list, {})
    expect(afterFirst).toHaveLength(2)

    const second = afterFirst.find((c) => c.seriesIndex === 1)!
    await as(t).mutation(api.cards.move, { id: second._id, status: 'paid' })

    const afterSecond = await as(t).query(api.cards.list, {})
    expect(afterSecond).toHaveLength(2)
  })

  test('the nightly job rolls a series whose date passed without being paid', async () => {
    const t = setup()
    // Dated a fortnight ago and never completed; next month's copy should
    // still appear.
    const date = Date.now() - 14 * DAY
    await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        recurrence: { frequency: 'weekly', interval: 1 },
      }),
    )

    const result = await t.mutation(internal.cards.rollAllSeries, {})
    expect(result.created).toBeGreaterThan(0)

    const cards = await as(t).query(api.cards.list, {})
    expect(cards.length).toBeGreaterThan(1)
    // Nothing is materialized past the roll-ahead window.
    for (const card of cards) {
      expect(card.date).toBeLessThanOrEqual(Date.now() + 46 * DAY)
    }
  })

  test('turning off recurring detaches the card from its series', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      }),
    )

    await as(t).mutation(api.cards.update, { id, recurring: false })
    const card = await as(t).query(api.cards.get, { id })

    expect(card?.recurrence).toBeUndefined()
    expect(card?.seriesId).toBeUndefined()

    await as(t).mutation(api.cards.move, { id, status: 'paid' })
    expect(await as(t).query(api.cards.list, {})).toHaveLength(1)
  })

  test('applyToSeries updates later occurrences but leaves earlier ones alone', async () => {
    const t = setup()
    const date = new Date(2026, 0, 1, 12).getTime()
    const first = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 1 },
      }),
    )
    await as(t).mutation(api.cards.move, { id: first, status: 'paid' })

    const cards = await as(t).query(api.cards.list, {})
    const second = cards.find((c) => c.seriesIndex === 1)!

    // The rent went up starting with this occurrence.
    await as(t).mutation(api.cards.update, {
      id: second._id,
      amountCents: 130000,
      applyToSeries: true,
    })

    expect((await as(t).query(api.cards.get, { id: first }))?.amountCents).toBe(120000)
    expect((await as(t).query(api.cards.get, { id: second._id }))?.amountCents).toBe(130000)
  })
})

describe('cards.duplicate', () => {
  test('copies a one-off card forward by a month', async () => {
    const t = setup()
    const date = Date.now()
    const id = await as(t).mutation(api.cards.create, expenseArgs({ date }))

    const copyId = await as(t).mutation(api.cards.duplicate, { id })
    const copy = await as(t).query(api.cards.get, { id: copyId })

    expect(copy?.description).toBe('Rent')
    expect(copy?.date).toBe(date + 30 * DAY)
    expect(copy?.seriesId).toBeUndefined()
  })

  test('copies a recurring card onto its next occurrence', async () => {
    const t = setup()
    const date = new Date(2026, 0, 31, 12).getTime()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        date,
        recurring: true,
        recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 },
      }),
    )

    const copyId = await as(t).mutation(api.cards.duplicate, { id })
    const copy = await as(t).query(api.cards.get, { id: copyId })

    // February clamps to the 28th without the rule losing the 31st.
    expect(new Date(copy!.date).getMonth()).toBe(1)
    expect(new Date(copy!.date).getDate()).toBe(28)
    expect(copy?.seriesIndex).toBe(1)
  })
})

describe('cards.remove and restore', () => {
  test('a deleted card can be restored verbatim', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({ source: 'Landlord', notes: 'Bumped in March', priority: 'high' }),
    )

    const snapshot = await as(t).mutation(api.cards.remove, { id })
    expect(await as(t).query(api.cards.list, {})).toHaveLength(0)

    const restoredId = await as(t).mutation(api.cards.restore, { card: snapshot })
    const restored = await as(t).query(api.cards.get, { id: restoredId })

    expect(restored).toMatchObject({
      description: 'Rent',
      amountCents: 120000,
      source: 'Landlord',
      notes: 'Bumped in March',
      priority: 'high',
    })
  })
})

describe('archiving', () => {
  test('archived cards leave the board but stay in history', async () => {
    const t = setup()
    const paid = await as(t).mutation(
      api.cards.create,
      expenseArgs({ status: 'paid', date: Date.now() - DAY }),
    )
    await as(t).mutation(api.cards.create, expenseArgs({ description: 'Still due' }))

    const result = await as(t).mutation(api.cards.archiveCompleted, {})
    expect(result.archived).toBe(1)
    expect(result.archivedIds).toEqual([paid])

    const live = await as(t).query(api.cards.list, {})
    expect(live.map((c) => c.description)).toEqual(['Still due'])

    const archived = await as(t).query(api.cards.listArchived, {})
    expect(archived.map((c) => c._id)).toEqual([paid])
  })

  test('unarchiving puts a card back on the board', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({ status: 'paid', date: Date.now() - DAY }),
    )
    await as(t).mutation(api.cards.archiveCompleted, {})
    await as(t).mutation(api.cards.unarchive, { id })

    expect(await as(t).query(api.cards.list, {})).toHaveLength(1)
  })

  test('unarchiveMany restores every archived id, for undoing a bulk close-out', async () => {
    const t = setup()
    const first = await as(t).mutation(
      api.cards.create,
      expenseArgs({ status: 'paid', date: Date.now() - DAY }),
    )
    const second = await as(t).mutation(
      api.cards.create,
      expenseArgs({ description: 'Groceries', status: 'paid', date: Date.now() - DAY }),
    )

    const { archivedIds } = await as(t).mutation(api.cards.archiveCompleted, {})
    expect(archivedIds).toEqual(expect.arrayContaining([first, second]))
    expect(await as(t).query(api.cards.list, {})).toHaveLength(0)

    await as(t).mutation(api.cards.unarchiveMany, { ids: archivedIds })
    expect(await as(t).query(api.cards.list, {})).toHaveLength(2)
  })
})

describe('due promotion', () => {
  test('promoteMyDueCards moves an upcoming expense into Due once its date arrives', async () => {
    const t = setup()
    const due = await as(t).mutation(
      api.cards.create,
      expenseArgs({ description: 'Rent', date: Date.now() - DAY }),
    )
    const notYet = await as(t).mutation(
      api.cards.create,
      expenseArgs({ description: 'Later', date: Date.now() + 30 * DAY }),
    )

    const { promoted } = await as(t).mutation(api.cards.promoteMyDueCards, {})
    expect(promoted).toBe(1)

    const cards = await as(t).query(api.cards.list, {})
    expect(cards.find((c) => c._id === due)?.status).toBe('due')
    expect(cards.find((c) => c._id === notYet)?.status).toBe('upcoming')
  })

  test('promoteMyDueCards leaves income cards alone — expected has no "due" column', async () => {
    const t = setup()
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        type: 'income',
        category: 'Salary',
        description: 'Payday',
        date: Date.now() - DAY,
      }),
    )

    await as(t).mutation(api.cards.promoteMyDueCards, {})

    const card = await as(t).query(api.cards.get, { id })
    expect(card?.status).toBe('expected')
  })

  test('is idempotent — running it twice does not re-promote or duplicate', async () => {
    const t = setup()
    await as(t).mutation(api.cards.create, expenseArgs({ date: Date.now() - DAY }))

    expect((await as(t).mutation(api.cards.promoteMyDueCards, {})).promoted).toBe(1)
    expect((await as(t).mutation(api.cards.promoteMyDueCards, {})).promoted).toBe(0)
    expect(await as(t).query(api.cards.list, {})).toHaveLength(1)
  })

  test('promoteAllDueCards sweeps every user, for boards nobody has open', async () => {
    const t = setup()
    const mine = await as(t).mutation(api.cards.create, expenseArgs({ date: Date.now() - DAY }))
    const theirs = await as(t, OTHER).mutation(
      api.cards.create,
      expenseArgs({ description: 'Theirs', date: Date.now() - DAY }),
    )

    const { promoted } = await t.mutation(internal.cards.promoteAllDueCards, {})
    expect(promoted).toBe(2)

    expect((await as(t).query(api.cards.get, { id: mine }))?.status).toBe('due')
    expect((await as(t, OTHER).query(api.cards.get, { id: theirs }))?.status).toBe('due')
  })
})

describe('cards.stats', () => {
  test('sums open cards in cents across the horizon', async () => {
    const t = setup()
    await as(t).mutation(api.cards.create, expenseArgs({ amountCents: 50000 }))
    await as(t).mutation(
      api.cards.create,
      expenseArgs({ type: 'income', category: 'Salary', amountCents: 200000 }),
    )

    const stats = await as(t).query(api.cards.stats, { horizonDays: 30 })
    expect(stats.upcomingExpenses).toBe(50000)
    expect(stats.expectedIncome).toBe(200000)
    expect(stats.net).toBe(150000)
  })

  test('projects a recurring card across the horizon', async () => {
    const t = setup()
    await as(t).mutation(
      api.cards.create,
      expenseArgs({
        amountCents: 10000,
        date: Date.now() + DAY,
        recurring: true,
        recurrence: { frequency: 'weekly', interval: 1 },
      }),
    )

    // A weekly $100 cost lands roughly five times in 30 days.
    const stats = await as(t).query(api.cards.stats, { horizonDays: 30 })
    expect(stats.upcomingExpenses).toBeGreaterThanOrEqual(40000)
    expect(stats.upcomingExpenses).toBeLessThanOrEqual(50000)
  })

  test('a materialized series is not double-counted', async () => {
    const t = setup()
    const date = Date.now() + DAY
    const id = await as(t).mutation(
      api.cards.create,
      expenseArgs({
        amountCents: 10000,
        date,
        recurring: true,
        recurrence: { frequency: 'weekly', interval: 1 },
      }),
    )

    const before = await as(t).query(api.cards.stats, { horizonDays: 30 })

    // Rolling the series turns a forecast occurrence into a real card. The
    // total must not move: only the newest card in a series forecasts.
    await as(t).mutation(internal.cards.rollAllSeries, {})
    const after = await as(t).query(api.cards.stats, { horizonDays: 30 })

    expect(after.upcomingExpenses).toBe(before.upcomingExpenses)
    expect(id).toBeTruthy()
  })

  test('counts overdue and due-soon expenses', async () => {
    const t = setup()
    await as(t).mutation(
      api.cards.create,
      expenseArgs({ date: Date.now() - 3 * DAY, amountCents: 5000 }),
    )
    await as(t).mutation(
      api.cards.create,
      expenseArgs({ date: Date.now() + 2 * DAY, amountCents: 2500 }),
    )

    const stats = await as(t).query(api.cards.stats, {})
    expect(stats.overdueCount).toBe(1)
    expect(stats.overdueAmount).toBe(5000)
    expect(stats.dueSoonCount).toBe(1)
    expect(stats.dueSoonAmount).toBe(2500)
  })

  test('reads a pre-migration float amount as cents', async () => {
    const t = setup()
    // Simulates a document written before the cents migration.
    await t.run(async (ctx) => {
      await ctx.db.insert('cards', {
        userId: USER.subject,
        type: 'expense',
        amount: 12.5,
        description: 'Legacy',
        date: Date.now() + DAY,
        category: 'Other',
        priority: 'medium',
        recurring: false,
        status: 'upcoming',
        order: 1000,
        createdAt: Date.now(),
      })
    })

    const stats = await as(t).query(api.cards.stats, {})
    expect(stats.upcomingExpenses).toBe(1250)
  })
})

describe('rollAheadDays', () => {
  test('floors at the minimum so a short horizon still gets next month', () => {
    expect(rollAheadDays(7)).toBe(ROLL_AHEAD_MIN_DAYS)
    expect(rollAheadDays(30)).toBe(ROLL_AHEAD_MIN_DAYS)
  })

  test('follows the horizon between the floor and the ceiling', () => {
    expect(rollAheadDays(60)).toBe(60)
  })

  test('caps at the ceiling so a year-long horizon does not flood a column', () => {
    expect(rollAheadDays(365)).toBe(ROLL_AHEAD_MAX_DAYS)
  })
})
