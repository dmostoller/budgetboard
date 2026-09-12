import { Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCents } from '#/lib/board'
import type { MoneyFormat } from '#/lib/board'

export interface BudgetProgress {
  _id: string
  category: string
  limitCents: number
  spentCents: number
  committedCents: number
  projectedCents: number
  remainingCents: number
}

/**
 * Budgets read as three quantities, not one: what is already spent, what is
 * still committed this month, and what is left. The committed segment is what
 * makes a budget useful early in the month — a ceiling you have already
 * promised away should say so on the 2nd, not on the 28th.
 */
function BudgetRow({ budget, money }: { budget: BudgetProgress; money?: MoneyFormat }) {
  const limit = Math.max(1, budget.limitCents)
  const spentPct = Math.min(100, (budget.spentCents / limit) * 100)
  const committedPct = Math.min(100 - spentPct, (budget.committedCents / limit) * 100)
  const over = budget.remainingCents < 0

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-foreground">{budget.category}</span>
        <span
          className={cn(
            'shrink-0 tabular-nums',
            over ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {formatCents(budget.projectedCents, money)} / {formatCents(budget.limitCents, money)}
        </span>
      </div>

      <div
        className="mt-1 flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={budget.projectedCents}
        aria-valuemin={0}
        aria-valuemax={budget.limitCents}
        aria-label={`${budget.category} budget`}
      >
        <span
          className={cn('h-full', over ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${spentPct}%` }}
        />
        <span
          className={cn('h-full', over ? 'bg-destructive/40' : 'bg-primary/40')}
          style={{ width: `${committedPct}%` }}
        />
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        {formatCents(budget.spentCents, money)} spent
        {budget.committedCents > 0
          ? ` · ${formatCents(budget.committedCents, money)} still committed`
          : ''}
        {' · '}
        <span className={over ? 'font-semibold text-destructive' : ''}>
          {over
            ? `${formatCents(Math.abs(budget.remainingCents), money)} over`
            : `${formatCents(budget.remainingCents, money)} left`}
        </span>
      </p>
    </div>
  )
}

export default function BudgetPanel({
  budgets,
  money,
}: {
  budgets: Array<BudgetProgress> | undefined
  money?: MoneyFormat
}) {
  if (!budgets || budgets.length === 0) return null

  // Trouble first: a budget you are about to blow is the one worth reading.
  const sorted = [...budgets].sort(
    (a, b) =>
      a.remainingCents / Math.max(1, a.limitCents) - b.remainingCents / Math.max(1, b.limitCents),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          <Wallet size={14} />
          This month’s budgets
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sorted.map((budget) => (
          <BudgetRow key={budget._id} budget={budget} money={money} />
        ))}
      </CardContent>
    </Card>
  )
}
