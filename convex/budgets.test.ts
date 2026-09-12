import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vite-plus/test'
import schema from './schema'
import { api } from './_generated/api'

const USER = { subject: 'user_1', issuer: 'test', tokenIdentifier: 'test|user_1' }
const OTHER = { subject: 'user_2', issuer: 'test', tokenIdentifier: 'test|user_2' }

const modules = import.meta.glob('./**/*.*s')

function setup() {
  return convexTest(schema, modules)
}

function as(t: ReturnType<typeof setup>, identity = USER) {
  return t.withIdentity(identity)
}

/** A date safely inside the current month, so tests never straddle a boundary. */
function midMonth(dayOffset = 0) {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 15 + dayOffset, 12).getTime()
}

function groceries(overrides: Record<string, unknown> = {}) {
  return {
    type: 'expense' as const,
    amountCents: 8000,
    description: 'Groceries',
    date: midMonth(),
    category: 'Groceries',
    ...overrides,
  }
}

describe('budgets.set', () => {
  test('creates then updates a budget for a category', async () => {
    const t = setup()
    const first = await as(t).mutation(api.budgets.set, {
      category: 'Groceries',
      limitCents: 40000,
    })
    const second = await as(t).mutation(api.budgets.set, {
      category: 'Groceries',
      limitCents: 50000,
    })

    expect(second).toBe(first)
    const budgets = await as(t).query(api.budgets.list, {})
    expect(budgets).toHaveLength(1)
    expect(budgets[0].limitCents).toBe(50000)
  })

  test('rejects a negative limit', async () => {
    const t = setup()
    await expect(
      as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: -1 }),
    ).rejects.toThrow(/positive/)
  })

  test('budgets are scoped to their owner', async () => {
    const t = setup()
    await as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: 40000 })
    expect(await as(t, OTHER).query(api.budgets.list, {})).toHaveLength(0)
  })
})

describe('budgets.progress', () => {
  test('separates what is spent from what is still committed', async () => {
    const t = setup()
    await as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: 40000 })
    await as(t).mutation(api.cards.create, groceries({ status: 'paid' }))
    await as(t).mutation(api.cards.create, groceries({ amountCents: 5000 }))

    const { budgets } = await as(t).query(api.budgets.progress, {})
    expect(budgets[0]).toMatchObject({
      category: 'Groceries',
      limitCents: 40000,
      spentCents: 8000,
      committedCents: 5000,
      projectedCents: 13000,
      remainingCents: 27000,
    })
  })

  test('reports a negative remainder once a budget is over', async () => {
    const t = setup()
    await as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: 10000 })
    await as(t).mutation(api.cards.create, groceries({ amountCents: 15000 }))

    const { budgets } = await as(t).query(api.budgets.progress, {})
    expect(budgets[0].remainingCents).toBe(-5000)
  })

  test('ignores cards dated outside the month', async () => {
    const t = setup()
    await as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: 40000 })

    const now = new Date()
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 10, 12).getTime()
    await as(t).mutation(api.cards.create, groceries({ date: nextMonth }))

    const { budgets } = await as(t).query(api.budgets.progress, {})
    expect(budgets[0].projectedCents).toBe(0)
  })

  test('counts occurrences a recurring card will still produce this month', async () => {
    const t = setup()
    await as(t).mutation(api.budgets.set, { category: 'Groceries', limitCents: 40000 })

    // A weekly shop starting on the 1st: the whole month is committed on day
    // one, which is the point of showing committed separately from spent.
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12).getTime()
    await as(t).mutation(
      api.cards.create,
      groceries({
        date: firstOfMonth,
        amountCents: 8000,
        recurring: true,
        recurrence: { frequency: 'weekly', interval: 1 },
      }),
    )

    const { budgets } = await as(t).query(api.budgets.progress, {})
    // Four or five shops in a month, at $80 each.
    expect(budgets[0].projectedCents).toBeGreaterThanOrEqual(32000)
  })
})
