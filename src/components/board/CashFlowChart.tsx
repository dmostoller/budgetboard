// This file is only ever reached through Board.tsx's `lazy(() => import('./CashFlowChart'))`,
// so recharts already ships in its own chunk, never the eager bundle — confirmed via
// `vp build`, where index-*.js contains no "recharts" and CashFlowChart/chart get their
// own asset files. react-doctor's static import scan can't see that upstream boundary.
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, XAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { cashFlowSeries, formatCents } from '#/lib/board'
import type { Card as BoardCard, MoneyFormat } from '#/lib/board'

const chartConfig = {
  balance: { label: 'Net position', color: 'var(--primary)' },
  scenario: { label: 'What if', color: 'var(--chart-2, oklch(0.7 0.15 45))' },
} satisfies ChartConfig

/**
 * Running net position across the horizon: income in, expenses out, starting
 * from zero.
 *
 * Zero is the deliberate baseline. The question this chart answers is whether
 * what comes in covers what goes out over the window — not what an account
 * balance will read, which would need a starting balance the app does not
 * ask for.
 */
export default function CashFlowChart({
  cards,
  horizonDays,
  money,
  scenarioCards,
}: {
  cards: Array<BoardCard>
  horizonDays: number
  money?: MoneyFormat
  /** When present, drawn as a second line for comparison. */
  scenarioCards?: Array<BoardCard>
}) {
  const base = cashFlowSeries(cards, horizonDays)
  const scenario = scenarioCards ? cashFlowSeries(scenarioCards, horizonDays) : null

  const data = base.map((point, i) => ({
    label: point.label,
    balance: point.balance,
    ...(scenario ? { scenario: scenario[i]?.balance ?? 0 } : {}),
  }))

  const trough = base.reduce(
    (low, p) => (p.balance < low.balance ? p : low),
    base[0] ?? { balance: 0, label: '' },
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Income vs expenses
        </CardTitle>
        {trough.balance < 0 ? (
          <p className="text-xs text-destructive">
            Lowest point {formatCents(trough.balance, money)} around {trough.label}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-50 w-full 2xl:h-70">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="cash-flow-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={40}
            />
            {/* Break-even: above it the window covers itself, below it does not. */}
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(value) => formatCents(Number(value), money)} />
              }
            />
            <Area
              dataKey="balance"
              type="monotone"
              fill="url(#cash-flow-fill)"
              stroke="var(--color-balance)"
            />
            {scenario ? (
              <Line
                dataKey="scenario"
                type="monotone"
                stroke="var(--color-scenario)"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
              />
            ) : null}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
