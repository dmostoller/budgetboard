import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

/**
 * The assistant's tool contracts — names, schemas, and which of them need the
 * user's approval before they run.
 *
 * These are deliberately separate from the implementations in `ai-tools.ts`.
 * The server attaches `.server()` handlers to them; the browser passes the
 * same definitions to the chat client so a paused tool call arrives typed —
 * the approval card knows it is looking at `deleteCard` with a card id, not
 * an anonymous blob. One declaration, both sides.
 */

export const cardTypeSchema = z.enum(['income', 'expense'])
export const prioritySchema = z.enum(['low', 'medium', 'high'])
export const statusSchema = z.enum(['upcoming', 'due', 'paid', 'expected', 'received'])

export const dateSchema = z
  .string()
  .describe(
    'The due date or expected date as YYYY-MM-DD. Resolve relative phrases ' +
      'like "next Friday" or "the 15th" against today\'s date.',
  )

export const amountSchema = z
  .number()
  .describe('Amount in dollars, always positive (e.g. 12.5 for $12.50)')

export const recurrenceSchema = z
  .object({
    frequency: z.enum(['weekly', 'monthly']),
    interval: z.number().int().min(1).describe('Repeat every N weeks or months'),
    weekday: z.number().int().min(0).max(6).optional().describe('Weekly only. 0 = Sunday.'),
    dayOfMonth: z
      .number()
      .int()
      .min(-1)
      .max(31)
      .optional()
      .describe('Monthly by date. Use -1 for the last day of the month.'),
    nthWeekday: z
      .object({
        ordinal: z.number().int().describe('1-4, or -1 for the last one in the month'),
        weekday: z.number().int().min(0).max(6),
      })
      .optional()
      .describe('Monthly by weekday, e.g. {ordinal: 2, weekday: 5} = the second Friday'),
    endsAfter: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Stop after this many occurrences in total, counting the first'),
    endsOn: dateSchema.optional().describe('Stop once occurrences pass this date'),
  })
  .describe('How the card repeats. Only meaningful when recurring is true.')

const cardSummary = z.object({
  id: z.string(),
  type: cardTypeSchema,
  amount: z.number(),
  description: z.string(),
  date: z.string(),
  category: z.string(),
  priority: prioritySchema,
  recurring: z.boolean(),
  source: z.string().optional(),
  status: statusSchema,
})

const mutationResult = z.object({ id: z.string(), summary: z.string() })

export const createCardDef = toolDefinition({
  name: 'createCard',
  description:
    'Create a new income or expense card on the board. Use this whenever ' +
    'the user describes money coming in or going out.',
  inputSchema: z.object({
    type: cardTypeSchema,
    amount: amountSchema,
    description: z.string().describe('Short label, e.g. "Rent" or "Netflix"'),
    date: dateSchema,
    category: z.string().describe('Category name. Call suggestCategory first if unsure.'),
    priority: prioritySchema.optional(),
    recurring: z
      .boolean()
      .optional()
      .describe('True for subscriptions, rent, salary and other repeats'),
    recurrence: recurrenceSchema.optional(),
    source: z.string().optional().describe('Payee or payer, e.g. "Netflix" or "Employer"'),
    notes: z.string().optional(),
    status: statusSchema
      .optional()
      .describe(
        'Column to place the card in. Defaults to upcoming (expense) or expected (income).',
      ),
  }),
  outputSchema: mutationResult,
})

export const updateCardDef = toolDefinition({
  name: 'updateCard',
  description:
    'Update fields on an existing card. Call listCards first to find the id. ' +
    'Only send the fields that change.',
  // Overwrites data the user entered themselves, and the previous values are
  // not recoverable from the transcript — worth a confirmation.
  needsApproval: true,
  inputSchema: z.object({
    id: z.string(),
    type: cardTypeSchema.optional(),
    amount: amountSchema.optional(),
    description: z.string().optional(),
    date: dateSchema.optional(),
    category: z.string().optional(),
    priority: prioritySchema.optional(),
    recurring: z.boolean().optional(),
    recurrence: recurrenceSchema.optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
    status: statusSchema.optional(),
    applyToSeries: z
      .boolean()
      .optional()
      .describe('Apply the change to every later occurrence in this card’s series too'),
  }),
  outputSchema: mutationResult,
})

export const moveCardDef = toolDefinition({
  name: 'moveCard',
  description:
    'Move a card to a different column — for example marking a bill paid or ' +
    'income received. Completing a recurring card also brings its next ' +
    'occurrence onto the board.',
  inputSchema: z.object({ id: z.string(), status: statusSchema }),
  outputSchema: mutationResult,
})

export const deleteCardDef = toolDefinition({
  name: 'deleteCard',
  description: 'Permanently delete a card.',
  // Irreversible. The approval card is the last stop before the data is gone,
  // so this one is never optional.
  needsApproval: true,
  inputSchema: z.object({
    id: z.string(),
    description: z.string().describe('The card’s description, so the user can confirm which one'),
  }),
  outputSchema: mutationResult,
})

export const duplicateCardDef = toolDefinition({
  name: 'duplicateCard',
  description:
    'Copy a card forward. A recurring card lands on its next occurrence; a ' +
    'one-off lands the given number of days later (30 by default).',
  inputSchema: z.object({
    id: z.string(),
    days: z.number().int().optional(),
    date: dateSchema.optional(),
  }),
  outputSchema: mutationResult,
})

export const listCardsDef = toolDefinition({
  name: 'listCards',
  description:
    'List the cards on the board, optionally filtered. Use this to find card ' +
    'ids and to answer questions about what is on the board.',
  inputSchema: z.object({
    type: cardTypeSchema.optional(),
    status: statusSchema.optional(),
    category: z.string().optional(),
    recurring: z.boolean().optional(),
    search: z.string().optional().describe('Case-insensitive match against description and source'),
    withinDays: z.number().optional().describe('Only cards dated within this many days from today'),
    includeCompleted: z.boolean().optional(),
  }),
  outputSchema: z.object({ count: z.number(), cards: z.array(cardSummary) }),
})

export const queryBalanceDef = toolDefinition({
  name: 'queryBalance',
  description:
    'Get totals for the board: upcoming expenses, expected income, net ' +
    'balance, overdue and due-soon counts. Recurring cards are projected ' +
    'across the horizon.',
  inputSchema: z.object({
    withinDays: z.number().optional().describe('Time horizon in days. Defaults to 30.'),
  }),
  outputSchema: z.object({
    upcomingExpenses: z.number(),
    expectedIncome: z.number(),
    net: z.number(),
    overdueCount: z.number(),
    overdueAmount: z.number(),
    dueSoonCount: z.number(),
    dueSoonAmount: z.number(),
    horizonDays: z.number(),
  }),
})

export const suggestCategoryDef = toolDefinition({
  name: 'suggestCategory',
  description:
    'List the categories available for a card type so you can pick an ' +
    'existing one instead of inventing a new name.',
  inputSchema: z.object({ type: cardTypeSchema }),
  outputSchema: z.object({ categories: z.array(z.string()) }),
})

export const checkBudgetsDef = toolDefinition({
  name: 'checkBudgets',
  description:
    'This month’s category budgets with what has been spent and what is ' +
    'still committed against each one.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    budgets: z.array(
      z.object({
        category: z.string(),
        limit: z.number(),
        spent: z.number(),
        committed: z.number(),
        remaining: z.number(),
      }),
    ),
  }),
})

export const setBudgetDef = toolDefinition({
  name: 'setBudget',
  description: 'Set or change the monthly spending cap for an expense category.',
  // Changes a standing rule the user set deliberately.
  needsApproval: true,
  inputSchema: z.object({
    category: z.string(),
    limit: z.number().describe('Monthly cap in dollars'),
  }),
  outputSchema: z.object({ summary: z.string() }),
})

/**
 * Declared to the browser's chat client purely for typing: it never executes
 * these, but knowing them is what makes a paused approval arrive as a typed
 * `tool-approval` interrupt.
 */
export const BOARD_TOOL_DEFS = [
  createCardDef,
  updateCardDef,
  moveCardDef,
  deleteCardDef,
  duplicateCardDef,
  listCardsDef,
  queryBalanceDef,
  suggestCategoryDef,
  checkBudgetsDef,
  setBudgetDef,
] as const
