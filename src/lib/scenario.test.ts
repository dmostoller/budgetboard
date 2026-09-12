import { describe, expect, test } from 'vite-plus/test'
import { DAY, fromDateInput } from './board'
import {
  applyScenario,
  compareScenario,
  draftToCard,
  horizonTotals,
  isScenarioActive,
} from './scenario'
import type { Card } from './board'
import type { DraftCard, Scenario } from './scenario'

const NOW = fromDateInput('2026-01-01')

function card(overrides: Partial<Card> = {}): Card {
  return {
    _id: 'card_1',
    _creationTime: 0,
    userId: 'user_1',
    type: 'expense',
    amountCents: 10000,
    description: 'Rent',
    date: NOW + 10 * DAY,
    category: 'Rent/Mortgage',
    priority: 'medium',
    recurring: false,
    status: 'upcoming',
    order: 1000,
    createdAt: 0,
    ...overrides,
  }
}

function draft(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    id: 'draft:1',
    type: 'expense',
    description: 'Car payment',
    amountCents: 40000,
    date: NOW + 5 * DAY,
    category: 'Transportation',
    recurring: false,
    ...overrides,
  }
}

const board = [
  card({ _id: 'rent', amountCents: 120000, date: NOW + 3 * DAY }),
  card({ _id: 'food', amountCents: 40000, date: NOW + 6 * DAY, category: 'Groceries' }),
  card({
    _id: 'pay',
    type: 'income',
    status: 'expected',
    amountCents: 200000,
    date: NOW + 14 * DAY,
    category: 'Salary',
  }),
]

describe('isScenarioActive', () => {
  test('an empty scenario changes nothing', () => {
    expect(isScenarioActive({ mutedCardIds: [], drafts: [] })).toBe(false)
    expect(isScenarioActive({ mutedCardIds: ['rent'], drafts: [] })).toBe(true)
    expect(isScenarioActive({ mutedCardIds: [], drafts: [draft()] })).toBe(true)
  })
})

describe('applyScenario', () => {
  test('removes muted cards and adds drafts', () => {
    const scenario: Scenario = { mutedCardIds: ['food'], drafts: [draft()] }
    const result = applyScenario(board, scenario)

    expect(result.map((c) => c._id).sort()).toEqual(['draft:1', 'pay', 'rent'])
  })

  test('leaves the real board untouched', () => {
    const scenario: Scenario = { mutedCardIds: ['rent'], drafts: [draft()] }
    applyScenario(board, scenario)
    // Nothing here writes: a scenario is a view, not an edit.
    expect(board.map((c) => c._id)).toEqual(['rent', 'food', 'pay'])
  })

  test('a draft becomes an open card in the right lane', () => {
    expect(draftToCard(draft())).toMatchObject({ status: 'upcoming', type: 'expense' })
    expect(draftToCard(draft({ type: 'income' }))).toMatchObject({ status: 'expected' })
  })
})

describe('horizonTotals', () => {
  test('compares income against expenses over the window', () => {
    const totals = horizonTotals(board, 30, NOW)
    expect(totals.incomeCents).toBe(200000)
    expect(totals.expenseCents).toBe(160000)
    expect(totals.netCents).toBe(40000)
  })

  test('ignores completed cards', () => {
    const totals = horizonTotals(
      [...board, card({ _id: 'done', status: 'paid', amountCents: 999999 })],
      30,
      NOW,
    )
    expect(totals.expenseCents).toBe(160000)
  })

  test('projects a recurring cost across the window', () => {
    const weekly = card({
      _id: 'shop',
      amountCents: 10000,
      date: NOW + DAY,
      recurring: true,
      recurrence: { frequency: 'weekly', interval: 1 },
    })
    // Five weekly shops inside 30 days, not one.
    expect(horizonTotals([weekly], 30, NOW).expenseCents).toBeGreaterThanOrEqual(40000)
  })
})

describe('compareScenario', () => {
  test('a new recurring expense shows up as a worse net position', () => {
    const scenario: Scenario = {
      mutedCardIds: [],
      drafts: [
        draft({
          amountCents: 40000,
          recurring: true,
          recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 6 },
        }),
      ],
    }

    const result = compareScenario(board, scenario, 30, NOW)

    expect(result.baseline.netCents).toBe(40000)
    expect(result.scenario.netCents).toBe(0)
    expect(result.deltaCents).toBe(-40000)
  })

  test('muting an expense improves the net position', () => {
    const result = compareScenario(board, { mutedCardIds: ['food'], drafts: [] }, 30, NOW)
    expect(result.deltaCents).toBe(40000)
  })

  test('reports the lowest point of the running balance', () => {
    // Rent lands on day 3, income not until day 14, so the trough is the
    // pinch point someone paycheck-to-paycheck actually cares about.
    const result = compareScenario(board, { mutedCardIds: [], drafts: [] }, 30, NOW)
    expect(result.baselineTrough.cents).toBe(-160000)
  })

  test('an empty scenario matches the baseline exactly', () => {
    const result = compareScenario(board, { mutedCardIds: [], drafts: [] }, 30, NOW)
    expect(result.deltaCents).toBe(0)
    expect(result.scenario).toEqual(result.baseline)
  })
})
