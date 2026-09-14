import { useState } from 'react'
import { KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import type { useMutation } from 'convex/react'
import { columnsForType, isWishlistStatus } from '#/lib/board'
import type { Card, CardStatus } from '#/lib/board'
import { pushToast, withToast, withUndo } from '#/lib/toast'
import type { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

type MoveCard = ReturnType<typeof useMutation<typeof api.cards.move>>

/** Drag-and-drop wiring for the board's columns: sensors, the card riding
 * under the cursor, and the column-crossing rules a drop has to satisfy. */
export function useCardDrag(
  byStatus: Map<CardStatus, Array<Card>>,
  moveCard: MoveCard,
  /**
   * Taking a card off the wishlist turns a "want by" date into a real one, so
   * the board asks for it instead of moving the card directly.
   */
  onLeaveWishlist: (card: Card, status: CardStatus) => void,
) {
  const [activeCard, setActiveCard] = useState<Card | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 6 },
    }),
    // Cards can also be picked up and moved with the keyboard.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function onDragStart(event: DragStartEvent) {
    setActiveCard((event.active.data.current?.card as Card | undefined) ?? null)
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    if (!over) return

    const card = active.data.current?.card as Card | undefined
    if (!card) return

    const overId = String(over.id)
    const targetStatus = overId.startsWith('column:')
      ? (overId.slice('column:'.length) as CardStatus)
      : ((over.data.current?.card as Card | undefined)?.status ?? card.status)

    if (!columnsForType(card.type).some((c) => c.status === targetStatus)) {
      // Income cards cannot land in expense columns and vice versa.
      pushToast(`A ${card.type} card can only move between its own columns`, 'error')
      return
    }

    if (isWishlistStatus(targetStatus) && !isWishlistStatus(card.status) && card.recurring) {
      pushToast('Recurring cards cannot go on the wishlist', 'error')
      return
    }

    if (isWishlistStatus(card.status) && !isWishlistStatus(targetStatus)) {
      onLeaveWishlist(card, targetStatus)
      return
    }

    const column = (byStatus.get(targetStatus) ?? []).filter((c) => c._id !== card._id)
    const overCard = over.data.current?.card as Card | undefined
    const index = overCard ? column.findIndex((c) => c._id === overCard._id) : column.length

    const after = index > 0 ? column[index - 1] : undefined
    const before = index >= 0 && index < column.length ? column[index] : undefined

    if (card.status === targetStatus && before?._id === card._id && after === undefined) {
      return
    }

    const crossesColumn = card.status !== targetStatus

    const promise = moveCard({
      id: card._id as Id<'cards'>,
      status: targetStatus,
      afterOrder: after?.order,
      beforeOrder: before?.order,
    })

    // Reordering inside a column is self-evident; moving a card to another
    // column is the one worth being able to take back.
    if (!crossesColumn) {
      await withToast(promise, { error: `Could not move "${card.description}"` })
      return
    }

    await withUndo(promise, {
      error: `Could not move "${card.description}"`,
      message: `Moved "${card.description}"`,
      undo: (result) =>
        moveCard({
          id: card._id as Id<'cards'>,
          status: result.previous.status,
          afterOrder: result.previous.order,
        }),
    })
  }

  return {
    sensors,
    activeCard,
    onDragStart,
    onDragEnd,
    onDragCancel: () => setActiveCard(null),
  }
}
