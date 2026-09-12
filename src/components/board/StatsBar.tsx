import { AlertTriangle, Clock, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatCents } from '#/lib/board'
import type { MoneyFormat } from '#/lib/board'

export interface BoardStats {
  upcomingExpenses: number
  expectedIncome: number
  net: number
  overdueCount: number
  overdueAmount: number
  dueSoonCount: number
  dueSoonAmount: number
}

const TONE_CLASS = {
  neutral: 'text-foreground',
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-destructive',
  warn: 'text-amber-600 dark:text-amber-400',
} as const

function Stat({
  icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tone?: keyof typeof TONE_CLASS
}) {
  const toneClass = TONE_CLASS[tone]

  return (
    <Card>
      <CardContent className="flex items-center gap-3">
        <span className={cn('shrink-0', toneClass)}>{icon}</span>
        <div className="min-w-0">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className={cn('text-base font-bold tabular-nums', toneClass)}>{value}</p>
          {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default function StatsBar({
  stats,
  horizonDays,
  money,
}: {
  stats: BoardStats | undefined
  horizonDays: number
  money?: MoneyFormat
}) {
  if (!stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[70px] rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Stat
        icon={<TrendingUp size={20} />}
        label="Expected income"
        value={formatCents(stats.expectedIncome, money)}
        sub={`next ${horizonDays} days`}
        tone="good"
      />
      <Stat
        icon={<TrendingDown size={20} />}
        label="Upcoming expenses"
        value={formatCents(stats.upcomingExpenses, money)}
        sub={`next ${horizonDays} days`}
      />
      <Stat
        icon={<Wallet size={20} />}
        label="Left over"
        value={formatCents(stats.net, money)}
        sub="income − expenses"
        tone={stats.net >= 0 ? 'good' : 'bad'}
      />
      <Stat
        icon={<AlertTriangle size={20} />}
        label="Overdue"
        value={String(stats.overdueCount)}
        sub={formatCents(stats.overdueAmount, money)}
        tone={stats.overdueCount > 0 ? 'bad' : 'neutral'}
      />
      <Stat
        icon={<Clock size={20} />}
        label="Due this week"
        value={String(stats.dueSoonCount)}
        sub={formatCents(stats.dueSoonAmount, money)}
        tone={stats.dueSoonCount > 0 ? 'warn' : 'neutral'}
      />
    </div>
  )
}
