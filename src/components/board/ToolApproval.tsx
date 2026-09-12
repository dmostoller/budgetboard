import { Check, ShieldQuestion, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCents, toCents } from '#/lib/board'
import type { MoneyFormat } from '#/lib/board'

/**
 * The human-in-the-loop gate for the assistant's destructive tools.
 *
 * TanStack AI pauses the run server-side when a tool declares
 * `needsApproval`, and surfaces it here as an interrupt. Nothing has happened
 * yet when this card renders: approving resumes the run and executes the
 * call, rejecting resumes it with a refusal the model has to account for.
 */

const TOOL_LABELS: Record<string, string> = {
  updateCard: 'Change this card',
  deleteCard: 'Delete this card',
  setBudget: 'Set a budget',
}

const DESTRUCTIVE_TOOLS = new Set(['deleteCard'])

/** Field names whose values are dollar amounts, so they read as money. */
const MONEY_FIELDS = new Set(['amount', 'limit'])

function formatValue(key: string, value: unknown, money?: MoneyFormat): string {
  if (value === null || value === undefined) return '—'
  if (MONEY_FIELDS.has(key) && typeof value === 'number') {
    return formatCents(toCents(value), money)
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  // Tool arguments are JSON, so anything left is an object or array; a
  // default `[object Object]` in an approval card would hide what is about
  // to change.
  return JSON.stringify(value) ?? ''
}

const HIDDEN_FIELDS = new Set(['id'])

export interface PendingApproval {
  id: string
  toolName: string
  args: Record<string, unknown>
  busy: boolean
  approve: () => void
  reject: () => void
}

export default function ToolApproval({
  approval,
  money,
}: {
  approval: PendingApproval
  money?: MoneyFormat
}) {
  const destructive = DESTRUCTIVE_TOOLS.has(approval.toolName)
  const entries = Object.entries(approval.args).filter(
    ([key, value]) => !HIDDEN_FIELDS.has(key) && value !== undefined,
  )

  return (
    <div
      className={`rounded-xl border p-3 text-sm ${
        destructive ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-muted/40'
      }`}
    >
      <p className="flex items-center gap-1.5 font-semibold text-foreground">
        <ShieldQuestion size={14} className={destructive ? 'text-destructive' : 'text-primary'} />
        {TOOL_LABELS[approval.toolName] ?? approval.toolName}
      </p>

      {entries.length > 0 ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground capitalize">
                {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </dt>
              <dd className="truncate font-medium text-foreground">
                {formatValue(key, value, money)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="mt-2 text-xs text-muted-foreground">
        {destructive ? 'This can’t be undone.' : 'Nothing has changed yet.'}
      </p>

      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          variant={destructive ? 'destructive' : 'default'}
          disabled={approval.busy}
          onClick={approval.approve}
        >
          <Check size={14} />
          {destructive ? 'Delete' : 'Approve'}
        </Button>
        <Button size="sm" variant="outline" disabled={approval.busy} onClick={approval.reject}>
          <X size={14} />
          Reject
        </Button>
      </div>
    </div>
  )
}
