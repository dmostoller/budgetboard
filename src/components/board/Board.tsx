import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import AISidebar from './AISidebar'
import BudgetPanel from './BudgetPanel'
import CardDialog from './CardDialog'
import BoardHeader from './BoardHeader'
import BoardDialogs from './BoardDialogs'
import BoardMain from './BoardMain'
import { useCardDrag } from './useCardDrag'
import { useBoardData } from './useBoardData'
import { useBoardActions } from './useBoardActions'
import { EMPTY_FILTERS } from '#/lib/board'
import { withToast } from '#/lib/toast'
import type { BoardFilters, Card, CardType, MoneyFormat } from '#/lib/board'
import type { Scenario } from '#/lib/scenario'
import type { CardDraft } from './CardDialog'
import type { Id } from '../../../convex/_generated/dataModel'

// Recharts is the single heaviest dependency this page pulls in. Loading the
// three chart components on demand keeps it out of the initial bundle for
// the board's first paint.
const CashFlowChart = lazy(() => import('./CashFlowChart'))
const CategoryChart = lazy(() => import('./CategoryChart'))
const OutflowChart = lazy(() => import('./OutflowChart'))

function ChartSkeleton() {
  return <div className="h-64 w-full animate-pulse rounded-2xl bg-muted/40" />
}

export default function Board() {
  // Every query is scoped by the identity on the request's JWT — there is no
  // user id to pass, and none the client could substitute.
  const cards = useQuery(api.cards.list, {}) as Array<Card> | undefined
  const settings = useQuery(api.settings.get, {})
  const categories = useQuery(api.categories.list, {})
  const budgets = useQuery(api.budgets.progress, {})
  const insights = useQuery(api.insights.list, {})
  const dismissedAlerts = useQuery(api.alerts.listDismissed, {})
  const stats = useQuery(api.cards.stats, { horizonDays: settings?.horizonDays ?? 30 })

  const createCard = useMutation(api.cards.create)
  const updateCard = useMutation(api.cards.update)
  const moveCard = useMutation(api.cards.move)
  const removeCard = useMutation(api.cards.remove)
  const restoreCard = useMutation(api.cards.restore)
  const duplicateCard = useMutation(api.cards.duplicate)
  const addCategory = useMutation(api.categories.add)
  const saveSettings = useMutation(api.settings.set)
  const archiveCompleted = useMutation(api.cards.archiveCompleted)
  const unarchiveMany = useMutation(api.cards.unarchiveMany)
  const dismissAlerts = useMutation(api.alerts.dismiss)
  const pruneAlerts = useMutation(api.alerts.prune)
  const dismissInsight = useMutation(api.insights.dismiss)
  const refreshInsights = useMutation(api.insights.refresh)

  const [draft, setDraft] = useState<CardDraft | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [cardToDelete, setCardToDelete] = useState<Card | null>(null)
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [scenario, setScenario] = useState<Scenario>({ mutedCardIds: [], drafts: [] })
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [now] = useState(() => Date.now())

  const horizonDays = settings?.horizonDays ?? 30
  const showCompleted = settings?.showCompleted ?? true
  const money: MoneyFormat = {
    currency: settings?.currency ?? 'USD',
    locale: settings?.locale ?? 'en-US',
  }

  const {
    withinHorizon,
    visible,
    byStatus,
    scenarioCards,
    budgetsByCategory,
    forecasts,
    boardIsEmpty,
    completedCount,
    hasBudgets,
    noMatches,
  } = useBoardData(
    cards,
    horizonDays,
    showCompleted,
    now,
    filters,
    scenario,
    budgets,
    dismissedAlerts,
    money,
    pruneAlerts,
  )

  const { sensors, activeCard, onDragStart, onDragEnd, onDragCancel } = useCardDrag(
    byStatus,
    moveCard,
  )

  const {
    refreshingInsights,
    archiving,
    submitCard,
    duplicateCard: onDuplicateCard,
    deleteCard,
    confirmArchive,
    refreshInsights: onRefreshInsights,
  } = useBoardActions(
    {
      createCard,
      updateCard,
      removeCard,
      restoreCard,
      duplicateCard,
      archiveCompleted,
      unarchiveMany,
      refreshInsights,
    },
    draft,
  )

  // Rendered either as full-width bands (below `wide`) or stacked in the
  // sticky rail beside the board (at `wide`).
  const cashFlowEl = (
    <Suspense fallback={<ChartSkeleton />}>
      <CashFlowChart
        cards={withinHorizon}
        horizonDays={horizonDays}
        money={money}
        scenarioCards={scenarioCards}
      />
    </Suspense>
  )
  const categoryEl = (
    <Suspense fallback={<ChartSkeleton />}>
      <CategoryChart
        cards={withinHorizon}
        horizonDays={horizonDays}
        money={money}
        budgetsByCategory={budgetsByCategory}
      />
    </Suspense>
  )
  const outflowEl = (
    <Suspense fallback={<ChartSkeleton />}>
      <OutflowChart cards={withinHorizon} horizonDays={horizonDays} money={money} />
    </Suspense>
  )
  const budgetEl = budgets?.budgets.length ? (
    <BudgetPanel budgets={budgets.budgets} money={money} />
  ) : null
  const allCategories = categories ? [...categories.expense, ...categories.income] : []

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 xl:max-w-350 2xl:max-w-none 2xl:px-8">
      <BoardHeader
        horizonDays={horizonDays}
        onHorizonChange={(days) =>
          void withToast(saveSettings({ horizonDays: days }), {
            error: 'Could not save your horizon',
          })
        }
        showCompleted={showCompleted}
        onShowCompletedChange={(pressed) =>
          void withToast(saveSettings({ showCompleted: pressed }), {
            error: 'Could not save that setting',
          })
        }
        cards={cards}
        money={money}
        dismissedAlerts={dismissedAlerts}
        alertsOpen={alertsOpen}
        onAlertsOpenChange={setAlertsOpen}
        onDismissAlerts={(alertIds) =>
          void withToast(dismissAlerts({ alertIds }), {
            error: 'Could not dismiss that alert',
          })
        }
        onOpenCard={(cardId) => {
          const card = cards?.find((c) => c._id === cardId)
          if (card) setDraft({ card, status: card.status })
        }}
        onNewCard={() => setDraft({ status: 'upcoming' })}
        onOpenAssistant={() => setAssistantOpen(true)}
      />

      <BoardMain
        boardIsEmpty={boardIsEmpty}
        insights={insights}
        refreshingInsights={refreshingInsights}
        cards={cards}
        onDismissInsight={(id) =>
          void withToast(dismissInsight({ id: id as Id<'insights'> }), {
            error: 'Could not dismiss that',
          })
        }
        onRefreshInsights={onRefreshInsights}
        onFilterToCards={(categories, fallbackSearch) =>
          setFilters(categories.length === 1 ? { categories } : { search: fallbackSearch })
        }
        stats={stats}
        horizonDays={horizonDays}
        money={money}
        scenarioOpen={scenarioOpen}
        scenario={scenario}
        onToggleScenario={() => setScenarioOpen((open) => !open)}
        onChangeScenario={setScenario}
        onCloseScenario={() => setScenarioOpen(false)}
        completedCount={completedCount}
        archiving={archiving}
        onOpenArchiveConfirm={() => setArchiveConfirmOpen(true)}
        categories={categories}
        withinHorizon={withinHorizon}
        cashFlowEl={cashFlowEl}
        categoryEl={categoryEl}
        outflowEl={outflowEl}
        budgetEl={budgetEl}
        hasBudgets={hasBudgets}
        onOpenAssistant={() => setAssistantOpen(true)}
        onNewCard={() => setDraft({ status: 'upcoming' })}
        filters={filters}
        allCategories={allCategories}
        onChangeFilters={setFilters}
        visibleCount={visible.length}
        sensors={sensors}
        activeCard={activeCard}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        byStatus={byStatus}
        forecasts={forecasts}
        onAddCard={(status) => setDraft({ status })}
        onOpenCard={(card) => setDraft({ card, status: card.status })}
        onDeleteCard={(card) => setCardToDelete(card)}
        onDuplicateCard={onDuplicateCard}
        noMatches={noMatches}
      />

      {draft && categories ? (
        <CardDialog
          draft={draft}
          categories={categories}
          onClose={() => setDraft(null)}
          onSubmit={submitCard}
          onAddCategory={(name: string, type: CardType) => addCategory({ name, type })}
        />
      ) : null}

      <AISidebar open={assistantOpen} onClose={() => setAssistantOpen(false)} money={money} />

      <BoardDialogs
        cardToDelete={cardToDelete}
        onCancelDelete={() => setCardToDelete(null)}
        onConfirmDelete={() => {
          if (!cardToDelete) return
          deleteCard(cardToDelete)
          setCardToDelete(null)
        }}
        completedCount={completedCount}
        archiveConfirmOpen={archiveConfirmOpen}
        onArchiveConfirmOpenChange={setArchiveConfirmOpen}
        onConfirmArchive={() => {
          setArchiveConfirmOpen(false)
          confirmArchive()
        }}
      />
    </div>
  )
}
