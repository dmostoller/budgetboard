import { v } from 'convex/values'
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import { cardCents, getUserId, isCompletedStatus, projectOccurrences, requireUserId } from './lib'

const DAY = 24 * 60 * 60 * 1000

/**
 * The assistant volunteering something instead of waiting to be asked.
 *
 * Findings are detected in code, not by the model: whether expenses outrun
 * income over the horizon is arithmetic, and arithmetic should not be left to
 * a language model. The model is used for the one thing it is better at —
 * saying it in a sentence a person actually reads. With no API key
 * configured the templated phrasing ships instead, so the feature degrades to
 * plain rather than to broken.
 */

export interface Finding {
  kind: 'shortfall' | 'over-budget' | 'top-category' | 'clustered-bills'
  headline: string
  detail: string
  cardIds: Array<string>
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getUserId(ctx)
    if (!userId) return []
    const rows = await ctx.db
      .query('insights')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()
    return rows
      .filter((r) => r.dismissedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5)
  },
})

export const dismiss = mutation({
  args: { id: v.id('insights') },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx)
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId) throw new Error('Insight not found')
    await ctx.db.patch(id, { dismissedAt: Date.now() })
  },
})

/** Ask for a fresh briefing right now, rather than waiting for Sunday. */
export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx)
    await ctx.scheduler.runAfter(0, internal.insights.generateForUser, { userId })
  },
})

export const insertInsight = internalMutation({
  args: {
    userId: v.string(),
    headline: v.string(),
    detail: v.string(),
    cardIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // One live insight of a given headline at a time; a weekly job should not
    // stack up the same observation four times a month.
    const existing = await ctx.db
      .query('insights')
      .withIndex('by_user', (q) => q.eq('userId', args.userId))
      .collect()

    for (const row of existing) {
      if (row.dismissedAt === undefined && row.headline === args.headline) return row._id
    }

    return await ctx.db.insert('insights', { ...args, createdAt: Date.now() })
  },
})

/** Everything the finding detectors need, in one transaction. */
export const boardSummary = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const [cards, budgets, settings] = await Promise.all([
      ctx.db
        .query('cards')
        .withIndex('by_user_archived', (q) => q.eq('userId', userId).eq('archivedAt', undefined))
        .collect(),
      ctx.db
        .query('budgets')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .collect(),
      ctx.db
        .query('settings')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .unique(),
    ])

    return {
      horizonDays: settings?.horizonDays ?? 30,
      insightsEnabled: settings?.insightsEnabled ?? true,
      currency: settings?.currency ?? 'USD',
      budgets: budgets.map((b) => ({ category: b.category, limitCents: b.limitCents })),
      cards: cards.map((c) => ({
        _id: String(c._id),
        type: c.type,
        amountCents: cardCents(c),
        description: c.description,
        date: c.date,
        category: c.category,
        recurring: c.recurring,
        recurrence: c.recurrence,
        seriesId: c.seriesId,
        seriesIndex: c.seriesIndex,
        status: c.status,
      })),
    }
  },
})

export const listUserIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [rows, cards] = await Promise.all([
      ctx.db.query('settings').collect(),
      ctx.db.query('cards').collect(),
    ])
    const ids = new Set<string>()
    for (const row of rows) ids.add(row.userId)
    for (const card of cards) ids.add(card.userId)
    return [...ids]
  },
})

type Summary = {
  horizonDays: number
  insightsEnabled: boolean
  currency: string
  budgets: Array<{ category: string; limitCents: number }>
  cards: Array<{
    _id: string
    type: 'income' | 'expense'
    amountCents: number
    description: string
    date: number
    category: string
    recurring: boolean
    recurrence?: any
    seriesId?: string
    seriesIndex?: number
    status: string
  }>
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100)
}

/**
 * The deterministic half: what is actually true about this board right now.
 * Ordered by how much it should change what someone does this week.
 */
export function detectFindings(summary: Summary, now = Date.now()): Array<Finding> {
  const findings: Array<Finding> = []
  const { currency } = summary
  const horizonEnd = now + summary.horizonDays * DAY
  const open = summary.cards.filter((c) => !isCompletedStatus(c.status))

  let income = 0
  let expenses = 0
  const expenseByCategory = new Map<string, { cents: number; ids: Set<string> }>()

  for (const { card } of projectOccurrences(open, now, horizonEnd)) {
    if (card.type === 'income') {
      income += card.amountCents
      continue
    }
    expenses += card.amountCents
    const bucket = expenseByCategory.get(card.category) ?? { cents: 0, ids: new Set<string>() }
    bucket.cents += card.amountCents
    bucket.ids.add(card._id)
    expenseByCategory.set(card.category, bucket)
  }

  // 1. Expenses outrunning income over the horizon. For anyone budgeting
  //    paycheck to paycheck this is the only number that decides the week.
  if (expenses > income) {
    const gap = expenses - income
    findings.push({
      kind: 'shortfall',
      headline: `Expenses run ${money(gap, currency)} ahead of income`,
      detail:
        `Over the next ${summary.horizonDays} days you have ` +
        `${money(expenses, currency)} going out against ${money(income, currency)} coming in.`,
      cardIds: [],
    })
  }

  // 2. A budget this month is already committed past its ceiling.
  const monthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime()
  const monthEnd = new Date(
    new Date(now).getFullYear(),
    new Date(now).getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  ).getTime()

  const monthByCategory = new Map<string, { cents: number; ids: Set<string> }>()
  for (const { card, date } of projectOccurrences(
    summary.cards.filter((c) => c.type === 'expense'),
    monthStart,
    monthEnd,
  )) {
    if (date < monthStart || date > monthEnd) continue
    const bucket = monthByCategory.get(card.category) ?? { cents: 0, ids: new Set<string>() }
    bucket.cents += card.amountCents
    bucket.ids.add(card._id)
    monthByCategory.set(card.category, bucket)
  }

  for (const budget of summary.budgets) {
    const bucket = monthByCategory.get(budget.category)
    if (!bucket || bucket.cents <= budget.limitCents) continue
    findings.push({
      kind: 'over-budget',
      headline: `${budget.category} is over budget this month`,
      detail:
        `${money(bucket.cents, currency)} committed against a ` +
        `${money(budget.limitCents, currency)} budget — ` +
        `${money(bucket.cents - budget.limitCents, currency)} over.`,
      cardIds: [...bucket.ids],
    })
  }

  // 3. The biggest expense category, which is where trimming actually moves
  //    the number.
  const top = [...expenseByCategory.entries()].sort((a, b) => b[1].cents - a[1].cents)[0]
  if (top && expenses > 0) {
    const share = Math.round((top[1].cents / expenses) * 100)
    findings.push({
      kind: 'top-category',
      headline: `${top[0]} is your largest expense`,
      detail:
        `${money(top[1].cents, currency)} over the next ${summary.horizonDays} days — ` +
        `${share}% of everything going out.`,
      cardIds: [...top[1].ids],
    })
  }

  // 4. Bills stacking up before the next income lands.
  const nextIncome = open
    .filter((c) => c.type === 'income' && c.date >= now)
    .sort((a, b) => a.date - b.date)[0]

  if (nextIncome) {
    const before = open.filter(
      (c) => c.type === 'expense' && c.date >= now && c.date < nextIncome.date,
    )
    const beforeCents = before.reduce((sum, c) => sum + c.amountCents, 0)
    if (before.length >= 2 && beforeCents > nextIncome.amountCents) {
      findings.push({
        kind: 'clustered-bills',
        headline: `${before.length} bills land before your next income`,
        detail:
          `${money(beforeCents, currency)} is due before ${nextIncome.description} ` +
          `(${money(nextIncome.amountCents, currency)}) arrives.`,
        cardIds: before.map((c) => c._id),
      })
    }
  }

  return findings
}

/**
 * The generative half: one finding, phrased like a person would say it.
 * Returns `null` whenever the model is unavailable or unhelpful, and the
 * caller falls back to the templated text.
 */
async function phrase(finding: Finding, horizonDays: number): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const prompt =
    `You write one-sentence budget observations for a cash-flow app. ` +
    `Rewrite the finding below as a single sentence of at most 30 words, plain and specific, ` +
    `no greeting, no emoji, no advice to "consider" anything. Keep every number exactly as given.\n\n` +
    `Horizon: ${horizonDays} days\nFinding: ${finding.headline}\nDetail: ${finding.detail}`

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.4 },
        }),
      },
    )
    if (!response.ok) return null

    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
    return text && text.length > 0 && text.length < 400 ? text : null
  } catch {
    return null
  }
}

export const generateForUser = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const summary: Summary = await ctx.runQuery(internal.insights.boardSummary, { userId })
    if (!summary.insightsEnabled) return { created: 0 }
    if (summary.cards.length === 0) return { created: 0 }

    const findings = detectFindings(summary)
    if (findings.length === 0) return { created: 0 }

    // One observation, not a digest. A weekly note people read beats a
    // dashboard they scroll past.
    const finding = findings[0]
    const detail = (await phrase(finding, summary.horizonDays)) ?? finding.detail

    await ctx.runMutation(internal.insights.insertInsight, {
      userId,
      headline: finding.headline,
      detail,
      cardIds: finding.cardIds,
    })

    return { created: 1 }
  },
})

export const generateForAllUsers = internalAction({
  args: {},
  handler: async (ctx) => {
    const userIds: Array<string> = await ctx.runQuery(internal.insights.listUserIds, {})
    await Promise.all(
      userIds.map((userId) => ctx.runAction(internal.insights.generateForUser, { userId })),
    )
    return { users: userIds.length }
  },
})
