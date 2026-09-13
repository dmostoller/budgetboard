import { DndContext, DragOverlay, closestCorners } from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import Column from './Column'
import { CardFace } from './BoardCard'
import { LANES } from '#/lib/board'
import type { Card, CardStatus, ColumnForecast, MoneyFormat } from '#/lib/board'

/** The board's swimlanes: drag-and-drop wiring around the per-status
 * columns, plus the ghost card that follows the cursor while dragging. */
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
}) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex flex-col gap-6">
        {LANES.map((lane) => (
          <section key={lane.type}>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              {lane.title}
            </h2>
            <div
              className={`grid gap-3 ${
                lane.columns.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'
              }`}
            >
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
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      <DragOverlay>
        {activeCard ? <CardFace card={activeCard} money={money} dragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}
