import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import Column from './Column'
import { CardFace } from './BoardCard'
import { LANES } from '#/lib/board'
import { cn } from '@/lib/utils'
import type { Card, CardStatus, ColumnForecast, Lane, MoneyFormat } from '#/lib/board'

const GRID_COLS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
}

const laneByKey = (key: Lane['key']) => LANES.find((lane) => lane.key === key)!

/** The board's swimlanes: drag-and-drop wiring around the per-status
 * columns, plus the ghost card that follows the cursor while dragging.
 *
 * Expenses take the first row. The second row puts the wishlist in the slot
 * under "Upcoming", beside income, so all columns share one three-wide grid.
 * Stacked on narrow screens the wishlist comes last: it is the least urgent
 * thing on the board. */
export default function BoardLanes({
  sensors,
  activeCard,
  onDragStart,
  onDragEnd,
  onDragCancel,
  byStatus,
  forecasts,
  money,
  onAddCard,
  onOpenCard,
  onDeleteCard,
  onDuplicateCard,
  affordableFrom,
}: {
  sensors: Array<SensorDescriptor<SensorOptions>>
  activeCard: Card | null
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
  byStatus: Map<CardStatus, Array<Card>>
  forecasts: Map<CardStatus, ColumnForecast>
  money: MoneyFormat
  onAddCard: (status: CardStatus) => void
  onOpenCard: (card: Card) => void
  onDeleteCard: (card: Card) => void
  onDuplicateCard: (card: Card) => void
  affordableFrom: Map<string, number | null>
}) {
  const section = (lane: Lane, className?: string) => (
    <section key={lane.key} className={className}>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {lane.title}
      </h2>
      <div className={cn('grid gap-3', GRID_COLS[lane.columns.length])}>
        {lane.columns.map((column) => (
          <Column
            key={column.status}
            status={column.status}
            title={column.title}
            cards={byStatus.get(column.status) ?? []}
            money={money}
            onAdd={() => onAddCard(column.status)}
            onOpen={onOpenCard}
            forecast={forecasts.get(column.status)}
            onDelete={onDeleteCard}
            onDuplicate={onDuplicateCard}
            affordableFrom={affordableFrom}
          />
        ))}
      </div>
    </section>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex flex-col gap-6">
        {section(laneByKey('expense'))}
        <div className="flex flex-col gap-6 md:grid md:grid-cols-3 md:gap-3">
          {section(laneByKey('income'), 'md:col-span-2')}
          {section(laneByKey('wishlist'), 'md:order-first')}
        </div>
      </div>

      <DragOverlay>
        {activeCard ? <CardFace card={activeCard} money={money} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}
