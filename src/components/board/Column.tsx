import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import BoardCard from './BoardCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { cardCents, formatCents } from '#/lib/board'
import type { Card, CardStatus, ColumnForecast, MoneyFormat } from '#/lib/board'

/**
 * "Sep 2027" — the granularity a forecast horizon deserves.
 *
 * Pinned to UTC so the server and the browser always render the same month,
 * even for a date that falls right at a local midnight boundary.
 */
function monthYear(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function Column({
  status,
  title,
  cards,
  money,
  onAdd,
  onOpen,
  onDelete,
  onDuplicate,
  forecast,
}: {
  status: CardStatus
  title: string
  cards: Array<Card>
  money?: MoneyFormat
  onAdd: () => void
  onOpen: (card: Card) => void
  onDelete: (card: Card) => void
  onDuplicate: (card: Card) => void
  /** Occurrences this column's series imply but have not materialized yet. */
  forecast?: ColumnForecast
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { status },
  })

  const total = cards.reduce((sum, c) => sum + cardCents(c), 0)

  return (
    <section
      ref={setNodeRef}
      className={cn(
        'flex min-h-[12rem] w-full flex-col rounded-2xl border p-3 transition',
        isOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/40',
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
          <Badge variant="secondary">{cards.length}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground tabular-nums">
            {formatCents(total, money)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onAdd}
            aria-label={`Add card to ${title}`}
          >
            <Plus />
          </Button>
        </div>
      </header>

      <SortableContext items={cards.map((c) => c._id)} strategy={verticalListSortingStrategy}>
        <ScrollArea className="max-h-[32rem]">
          <div className="flex flex-col gap-2 pr-3">
            {cards.map((card) => (
              <BoardCard
                key={card._id}
                card={card}
                money={money}
                onOpen={() => onOpen(card)}
                onDelete={() => onDelete(card)}
                onDuplicate={() => onDuplicate(card)}
              />
            ))}
            {cards.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                Drop cards here
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </SortableContext>

      {forecast && forecast.count > 0 ? (
        <p className="mt-2 border-t border-border pt-2 text-center text-xs text-muted-foreground">
          +{forecast.count} more forecast through {monthYear(forecast.through)}
        </p>
      ) : null}
    </section>
  )
}
