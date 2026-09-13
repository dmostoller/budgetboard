import { useState } from 'react'
import { toCardMutationArgs } from './CardDialog'
import { withToast, withUndo } from '#/lib/toast'
import type { Card } from '#/lib/board'
import type { CardDraft, CardFormValues } from './CardDialog'
import type { Id } from '../../../convex/_generated/dataModel'

type Mutations = {
  createCard: (args: ReturnType<typeof toCardMutationArgs>) => Promise<unknown>
  updateCard: (
    args: ReturnType<typeof toCardMutationArgs> & { id: Id<'cards'> },
  ) => Promise<unknown>
  removeCard: (args: { id: Id<'cards'> }) => Promise<unknown>
  // Convex's restore validator requires amountCents as non-optional, narrower
  // than the client-side Card type, so the wrapper accepts the mutation's own
  // arg shape rather than trying to line up with Card exactly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  restoreCard: (args: { card: any }) => Promise<unknown>
  duplicateCard: (args: { id: Id<'cards'> }) => Promise<unknown>
  archiveCompleted: (args: {
    before?: number
  }) => Promise<{ archived: number; archivedIds: Array<Id<'cards'>> }>
  unarchiveMany: (args: { ids: Array<Id<'cards'>> }) => Promise<unknown>
  refreshInsights: (args?: Record<string, never>) => Promise<unknown>
}

export function useBoardActions(mutations: Mutations, draft: CardDraft | null) {
  const [refreshingInsights, setRefreshingInsights] = useState(false)
  const [archiving, setArchiving] = useState(false)

  async function submitCard(values: CardFormValues) {
    const args = toCardMutationArgs(values)
    if (draft?.card) {
      await withToast(mutations.updateCard({ id: draft.card._id as Id<'cards'>, ...args }), {
        error: 'Could not save your changes',
      })
    } else {
      await withToast(mutations.createCard(args), { error: 'Could not create the card' })
    }
  }

  function duplicateCard(card: Card) {
    void withUndo(mutations.duplicateCard({ id: card._id as Id<'cards'> }), {
      error: 'Could not copy that card',
      message: `Copied "${card.description}" forward`,
      undo: (id) => mutations.removeCard({ id: id as Id<'cards'> }),
    })
  }

  function deleteCard(card: Card) {
    void withUndo(mutations.removeCard({ id: card._id as Id<'cards'> }), {
      error: 'Could not delete that card',
      message: `Deleted "${card.description}"`,
      // The mutation hands back the whole document, so undo puts
      // the card back verbatim rather than approximating it.
      undo: (restored) => mutations.restoreCard({ card: restored as Card }),
    })
  }

  function confirmArchive() {
    setArchiving(true)
    void withUndo(mutations.archiveCompleted({}), {
      error: 'Could not archive',
      message: (r) => `Archived ${r.archived} completed card${r.archived === 1 ? '' : 's'}`,
      undo: (r) => mutations.unarchiveMany({ ids: r.archivedIds }),
    }).finally(() => setArchiving(false))
  }

  function refreshInsights() {
    setRefreshingInsights(true)
    void withToast(mutations.refreshInsights({}), { error: 'Could not refresh' }).finally(() =>
      // The briefing is generated in the background; the spinner is
      // a hint that something is happening, not a completion signal.
      setTimeout(() => setRefreshingInsights(false), 4000),
    )
  }

  return {
    refreshingInsights,
    archiving,
    submitCard,
    duplicateCard,
    deleteCard,
    confirmArchive,
    refreshInsights,
  }
}
