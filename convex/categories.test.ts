import { convexTest } from 'convex-test'
import { describe, expect, test } from 'vite-plus/test'
import schema from './schema'
import { api } from './_generated/api'
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from './categories'

const DAY = 24 * 60 * 60 * 1000
const USER = { subject: 'user_1', issuer: 'test', tokenIdentifier: 'test|user_1' }
const OTHER = { subject: 'user_2', issuer: 'test', tokenIdentifier: 'test|user_2' }

const modules = import.meta.glob('./**/*.*s')

function setup() {
  return convexTest(schema, modules)
}

function as(t: ReturnType<typeof setup>, identity = USER) {
  return t.withIdentity(identity)
}

function expenseArgs(overrides: Record<string, unknown> = {}) {
  return {
    type: 'expense' as const,
    amountCents: 5000,
    description: 'Kibble',
    date: Date.now() + DAY,
    category: 'Pet care',
    ...overrides,
  }
}

describe('categories.list', () => {
  test('returns the built-in categories for a fresh account', async () => {
    const t = setup()
    const categories = await as(t).query(api.categories.list, {})

    expect(categories.expense).toEqual(DEFAULT_EXPENSE_CATEGORIES)
    expect(categories.income).toEqual(DEFAULT_INCOME_CATEGORIES)
    expect(categories.custom).toEqual([])
  })

  test('appends custom categories after the built-ins', async () => {
    const t = setup()
    await as(t).mutation(api.categories.add, { name: 'Pet care', type: 'expense' })

    const categories = await as(t).query(api.categories.list, {})
    expect(categories.expense.at(-1)).toBe('Pet care')
    expect(categories.income).toEqual(DEFAULT_INCOME_CATEGORIES)
  })

  test('does not leak one account’s categories into another', async () => {
    const t = setup()
    await as(t).mutation(api.categories.add, { name: 'Pet care', type: 'expense' })

    const theirs = await as(t, OTHER).query(api.categories.list, {})
    expect(theirs.expense).toEqual(DEFAULT_EXPENSE_CATEGORIES)
  })
})

describe('categories.add', () => {
  test('trims the name', async () => {
    const t = setup()
    await as(t).mutation(api.categories.add, { name: '  Pet care  ', type: 'expense' })
    const categories = await as(t).query(api.categories.list, {})
    expect(categories.expense).toContain('Pet care')
  })

  test('rejects an empty name', async () => {
    const t = setup()
    await expect(
      as(t).mutation(api.categories.add, { name: '   ', type: 'expense' }),
    ).rejects.toThrow(/required/)
  })

  test('is idempotent regardless of case', async () => {
    const t = setup()
    const first = await as(t).mutation(api.categories.add, { name: 'Pet care', type: 'expense' })
    const second = await as(t).mutation(api.categories.add, { name: 'PET CARE', type: 'expense' })

    expect(second).toBe(first)
    expect((await as(t).query(api.categories.list, {})).custom).toHaveLength(1)
  })
})

describe('categories.remove', () => {
  test('reassigns the cards filed under a removed category', async () => {
    const t = setup()
    const categoryId = await as(t).mutation(api.categories.add, {
      name: 'Pet care',
      type: 'expense',
    })
    const cardId = await as(t).mutation(api.cards.create, expenseArgs())

    const result = await as(t).mutation(api.categories.remove, {
      id: categoryId,
      reassignTo: 'Groceries',
    })

    expect(result).toEqual({ reassigned: 1, reassignedTo: 'Groceries' })
    // The card must never be left pointing at a category the picker cannot
    // offer — that is what made it invisible in the editor before.
    expect((await as(t).query(api.cards.get, { id: cardId }))?.category).toBe('Groceries')
  })

  test('falls back to Other when no destination is given', async () => {
    const t = setup()
    const categoryId = await as(t).mutation(api.categories.add, {
      name: 'Pet care',
      type: 'expense',
    })
    const cardId = await as(t).mutation(api.cards.create, expenseArgs())

    await as(t).mutation(api.categories.remove, { id: categoryId })
    expect((await as(t).query(api.cards.get, { id: cardId }))?.category).toBe('Other')
  })

  test('drops a budget attached to the removed category', async () => {
    const t = setup()
    const categoryId = await as(t).mutation(api.categories.add, {
      name: 'Pet care',
      type: 'expense',
    })
    await as(t).mutation(api.budgets.set, { category: 'Pet care', limitCents: 10000 })

    await as(t).mutation(api.categories.remove, { id: categoryId })

    // A budget on a category that no longer exists could never be measured.
    expect(await as(t).query(api.budgets.list, {})).toHaveLength(0)
  })

  test('refuses to remove another account’s category', async () => {
    const t = setup()
    const categoryId = await as(t).mutation(api.categories.add, {
      name: 'Pet care',
      type: 'expense',
    })

    await expect(as(t, OTHER).mutation(api.categories.remove, { id: categoryId })).rejects.toThrow(
      /not found/i,
    )
  })
})

describe('categories.usage', () => {
  test('counts the cards using a category', async () => {
    const t = setup()
    await as(t).mutation(api.cards.create, expenseArgs())
    await as(t).mutation(api.cards.create, expenseArgs({ description: 'Vet' }))
    await as(t).mutation(api.cards.create, expenseArgs({ category: 'Groceries' }))

    expect(await as(t).query(api.categories.usage, { name: 'Pet care' })).toEqual({ count: 2 })
  })
})
