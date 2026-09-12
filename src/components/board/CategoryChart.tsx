import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'
import { DAY, cardCents, formatCents, isCompleted, projectOccurrences } from '#/lib/board'
import type { Card as BoardCard, MoneyFormat } from '#/lib/board'

const chartConfig = {
  amount: { label: 'Amount', color: 'var(--primary)' },
} satisfies ChartConfig

/**
 * Where the money goes, with recurring series projected across the horizon so
 * a weekly cost is not visually outranked by a one-off it dwarfs over a month.
 *
 * Bars for categories with a budget turn red once the horizon's projection
 * passes it, which is the one place spending and budgets are visible side by
 * side.
 */
export default function CategoryChart({
  cards,
  horizonDays,
  money,
  budgetsByCategory,
}: {
  cards: Array<BoardCard>
  horizonDays: number
  money?: MoneyFormat
  budgetsByCategory?: Record<string, number>
}) {
  const now = Date.now()
  const horizonEnd = now + horizonDays * DAY

  const totals = new Map<string, number>()

  // A completed card is a single realized amount; an open one projects its
  // whole series across the window.
  for (const card of cards) {
    if (card.type !== 'expense') continue
    if (!isCompleted(card.status)) continue
    if (card.date < now - horizonDays * DAY || card.date > horizonEnd) continue
    totals.set(card.category, (totals.get(card.category) ?? 0) + cardCents(card))
  }

  const open = cards.filter((c) => c.type === 'expense' && !isCompleted(c.status))
  for (const { card } of projectOccurrences(open, now, horizonEnd)) {
    totals.set(card.category, (totals.get(card.category) ?? 0) + cardCents(card))
  }

  const data = Array.from(totals, ([category, amount]) => ({
    category,
    amount,
    over: budgetsByCategory?.[category] !== undefined && amount > budgetsByCategory[category],
  }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  if (data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Spending by category
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-50 w-full 2xl:h-70">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(value) => formatCents(Number(value), money)} />
              }
            />
            <Bar dataKey="amount" radius={4}>
              {data.map((entry) => (
                <Cell
                  key={entry.category}
                  fill={entry.over ? 'var(--destructive)' : 'var(--color-amount)'}
                />
              ))}
            </Bar>
            {/* A single budget line only reads correctly when every bar shares
                it, so it is drawn for the top category alone. */}
            {budgetsByCategory?.[data[0].category] !== undefined ? (
              <ReferenceLine
                y={budgetsByCategory[data[0].category]}
                stroke="var(--destructive)"
                strokeDasharray="4 4"
              />
            ) : null}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
