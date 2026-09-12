import { describe, expect, test } from 'vitest'
import { detectFindings } from './insights'

const DAY = 24 * 60 * 60 * 1000
/** Mid-month, so a test never straddles a month boundary. */
const NOW = new Date(2026, 2, 10, 12).getTime()

function summary(overrides: Partial<Parameters<typeof detectFindings>[0]> = {}) {
  return {
    horizonDays: 30,
    insightsEnabled: true,
    currency: 'USD',
    budgets: [],
    cards: [],
    ...overrides,
  } as Parameters<typeof detectFindings>[0]
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'c1',
    type: 'expense' as const,
    amountCents: 10000,
    description: 'Rent',
    date: NOW + 5 * DAY,
    category: 'Rent/Mortgage',
    recurring: false,
    status: 'upcoming',
    ...overrides,
  }
}

describe('shortfall', () => {
  test('reports the gap when expenses outrun income', () => {
    const findings = detectFindings(
      summary({
        cards: [
          card({ _id: 'rent', amountCents: 120000 }),
          card({
            _id: 'pay',
            type: 'income',
            status: 'expected',
            amountCents: 100000,
            category: 'Salary',
          }),
        ],
      }),
      NOW,
    )

    const shortfall = findings.find((f) => f.kind === 'shortfall')
    expect(shortfall).toBeDefined()
    expect(shortfall!.headline).toContain('$200')
    // The shortfall is what someone budgeting paycheck to paycheck needs
    // first, so it must lead.
    expect(findings[0].kind).toBe('shortfall')
  })

  test('says nothing when income covers expenses', () => {
    const findings = detectFindings(
      summary({
        cards: [
          card({ _id: 'rent', amountCents: 50000 }),
          card({
            _id: 'pay',
            type: 'income',
            status: 'expected',
            amountCents: 200000,
            category: 'Salary',
          }),
        ],
      }),
      NOW,
    )

    expect(findings.some((f) => f.kind === 'shortfall')).toBe(false)
  })

  test('ignores completed cards', () => {
    const findings = detectFindings(
      summary({
        cards: [card({ _id: 'done', amountCents: 999999, status: 'paid' })],
      }),
      NOW,
    )
    expect(findings.some((f) => f.kind === 'shortfall')).toBe(false)
  })
})

describe('over-budget', () => {
  test('flags a category committed past its ceiling', () => {
    const findings = detectFindings(
      summary({
        budgets: [{ category: 'Groceries', limitCents: 40000 }],
        cards: [card({ _id: 'g', category: 'Groceries', amountCents: 55000 })],
      }),
      NOW,
    )

    const over = findings.find((f) => f.kind === 'over-budget')
    expect(over).toBeDefined()
    expect(over!.headline).toContain('Groceries')
    expect(over!.detail).toContain('$150')
    expect(over!.cardIds).toContain('g')
  })

  test('stays quiet while a budget is still within its cap', () => {
    const findings = detectFindings(
      summary({
        budgets: [{ category: 'Groceries', limitCents: 40000 }],
        cards: [card({ _id: 'g', category: 'Groceries', amountCents: 20000 })],
      }),
      NOW,
    )
    expect(findings.some((f) => f.kind === 'over-budget')).toBe(false)
  })
})

describe('top-category', () => {
  test('names the largest expense category and its share', () => {
    const findings = detectFindings(
      summary({
        cards: [
          card({ _id: 'a', category: 'Rent/Mortgage', amountCents: 75000 }),
          card({ _id: 'b', category: 'Groceries', amountCents: 25000 }),
        ],
      }),
      NOW,
    )

    const top = findings.find((f) => f.kind === 'top-category')
    expect(top!.headline).toContain('Rent/Mortgage')
    expect(top!.detail).toContain('75%')
  })
})

describe('clustered-bills', () => {
  test('warns when bills before the next payday exceed it', () => {
    const findings = detectFindings(
      summary({
        cards: [
          card({ _id: 'a', amountCents: 90000, date: NOW + DAY }),
          card({ _id: 'b', amountCents: 60000, date: NOW + 2 * DAY }),
          card({
            _id: 'pay',
            type: 'income',
            status: 'expected',
            amountCents: 100000,
            category: 'Salary',
            date: NOW + 7 * DAY,
          }),
        ],
      }),
      NOW,
    )

    const clustered = findings.find((f) => f.kind === 'clustered-bills')
    expect(clustered).toBeDefined()
    expect(clustered!.headline).toContain('2 bills')
    expect(clustered!.cardIds.sort()).toEqual(['a', 'b'])
  })

  test('stays quiet when the paycheck covers what precedes it', () => {
    const findings = detectFindings(
      summary({
        cards: [
          card({ _id: 'a', amountCents: 10000, date: NOW + DAY }),
          card({ _id: 'b', amountCents: 10000, date: NOW + 2 * DAY }),
          card({
            _id: 'pay',
            type: 'income',
            status: 'expected',
            amountCents: 300000,
            category: 'Salary',
            date: NOW + 7 * DAY,
          }),
        ],
      }),
      NOW,
    )
    expect(findings.some((f) => f.kind === 'clustered-bills')).toBe(false)
  })
})

describe('an empty board', () => {
  test('produces no findings at all', () => {
    expect(detectFindings(summary(), NOW)).toEqual([])
  })
})
