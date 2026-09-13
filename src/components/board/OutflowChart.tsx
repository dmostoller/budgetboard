// Only reached through Board.tsx's lazy(() => import('./OutflowChart')); recharts is
// already code-split away from the eager bundle (verified with `vp build`).
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { DAILY_BUCKET_CUTOFF_DAYS, formatCents, outflowSeries } from '#/lib/board'
import type { Card as BoardCard, MoneyFormat } from '#/lib/board'

const chartConfig = {
  expense: { label: 'Out', color: 'var(--primary)' },
  income: { label: 'In', color: 'var(--chart-2, oklch(0.7 0.15 45))' },
} satisfies ChartConfig

/**
 * Money out per period, with income behind it for comparison.
 *
 * The companion to `CashFlowChart`: that one is cumulative and so smooths
 * timing on purpose, which hides the week where rent, insurance and a card
 * payment all land together. This one answers which period gets squeezed.
 * Bars where outgo exceeds income are drawn in the destructive color, since
 * those are the only ones worth acting on.
 */
export default function OutflowChart({
  cards,
  horizonDays,
  money,
}: {
  cards: Array<BoardCard>
  horizonDays: number
  money?: MoneyFormat
}) {
  const data = outflowSeries(cards, horizonDays)

  if (data.every((bucket) => bucket.expense === 0 && bucket.income === 0)) return null

  const worst = data.reduce(
    (high, bucket) => (bucket.expense > high.expense ? bucket : high),
    data[0],
  )
  const perDay = horizonDays <= DAILY_BUCKET_CUTOFF_DAYS

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          {perDay ? 'Out by day' : 'Out by week'}
        </CardTitle>
        {worst.expense > worst.income ? (
          <p className="text-xs text-muted-foreground">
            Heaviest {perDay ? 'day' : 'week'}: {formatCents(worst.expense, money)} around{' '}
            {worst.label}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-50 w-full 2xl:h-70">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(value) => formatCents(Number(value), money)} />
              }
            />
            <Bar dataKey="income" radius={4} fill="var(--color-income)" fillOpacity={0.35} />
            <Bar dataKey="expense" radius={4}>
              {data.map((bucket) => (
                <Cell
                  key={bucket.start}
                  fill={
                    bucket.expense > bucket.income ? 'var(--destructive)' : 'var(--color-expense)'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
