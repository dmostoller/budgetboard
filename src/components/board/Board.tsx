import { useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { useMutation, useQuery } from 'convex/react'
import { Archive, Bot, CheckCheck, FlaskConical, Loader2, Plus } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import Column from './Column'
import StatsBar from './StatsBar'
import CategoryChart from './CategoryChart'
import CashFlowChart from './CashFlowChart'
import OutflowChart from './OutflowChart'
import AISidebar from './AISidebar'
import NotificationsBell from './NotificationsBell'
import BoardFilterBar from './BoardFilterBar'
import BudgetPanel from './BudgetPanel'
import InsightsBanner from './InsightsBanner'
import ScenarioPanel from './ScenarioPanel'
import CardDialog, { toCardMutationArgs } from './CardDialog'
import { CardFace } from './BoardCard'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DAY,
  EMPTY_FILTERS,
  HORIZON_OPTIONS,
  LANES,
  filterBoardCards,
  forecastByStatus,
  hasActiveFilters,
  isCompleted,
} from '#/lib/board'
import { applyScenario, isScenarioActive } from '#/lib/scenario'
import { buildAlerts, staleDismissals } from '#/lib/notifications'
import { pushToast, withToast, withUndo } from '#/lib/toast'
import type { BoardFilters, Card, CardStatus, CardType, MoneyFormat } from '#/lib/board'
import type { Scenario } from '#/lib/scenario'
import type { CardDraft, CardFormValues } from './CardDialog'
import type { Id } from '../../../convex/_generated/dataModel'

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
  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [cardToDelete, setCardToDelete] = useState<Card | null>(null)
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS)
  const [scenario, setScenario] = useState<Scenario>({ mutedCardIds: [], drafts: [] })
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [refreshingInsights, setRefreshingInsights] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [now] = useState(() => Date.now())

  const horizonDays = settings?.horizonDays ?? 30
  const showCompleted = settings?.showCompleted ?? true
  const money: MoneyFormat = {
    currency: settings?.currency ?? 'USD',
    locale: settings?.locale ?? 'en-US',
  }

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

  const withinHorizon = useMemo(() => {
    if (!cards) return []
    const horizon = now + horizonDays * DAY
    return cards.filter((card) => {
      if (!showCompleted && isCompleted(card.status)) return false
      // Completed cards stay visible regardless of horizon so a just-paid bill
      // does not vanish from under the cursor.
      return card.date <= horizon || isCompleted(card.status)
    })
  }, [cards, horizonDays, showCompleted, now])

  const visible = useMemo(() => filterBoardCards(withinHorizon, filters), [withinHorizon, filters])

  const byStatus = useMemo(() => {
    const map = new Map<CardStatus, Array<Card>>()
    for (const lane of LANES) {
      for (const column of lane.columns) map.set(column.status, [])
    }
    for (const card of visible) map.get(card.status)?.push(card)
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [visible])

  const scenarioCards = useMemo(
    () => (isScenarioActive(scenario) ? applyScenario(withinHorizon, scenario) : undefined),
    [withinHorizon, scenario],
  )

  const budgetsByCategory = useMemo(() => {
    const map: Record<string, number> = {}
    for (const budget of budgets?.budgets ?? []) map[budget.category] = budget.limitCents
    return map
  }, [budgets])

  // Dismissals whose alert can no longer occur are dropped, so the table
  // cannot grow forever. Runs when the board settles, not on every render.
  useEffect(() => {
    if (!cards || !dismissedAlerts?.length) return
    const stale = staleDismissals(dismissedAlerts, buildAlerts(cards, Date.now(), money))
    if (stale.length === 0) return
    void pruneAlerts({
      liveAlertIds: buildAlerts(cards, Date.now(), money).map((a) => a.id),
    })
    // `money` is derived from settings and stable enough; the effect is
    // idempotent either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, dismissedAlerts])

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

    const lane = LANES.find((l) => l.type === card.type)!
    if (!lane.columns.some((c) => c.status === targetStatus)) {
      // Income cards cannot land in expense columns and vice versa.
      pushToast(`A ${card.type} card can only move between its own columns`, 'error')
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

  async function submitCard(values: CardFormValues) {
    const args = toCardMutationArgs(values)
    if (draft?.card) {
      await withToast(updateCard({ id: draft.card._id as Id<'cards'>, ...args }), {
        error: 'Could not save your changes',
      })
    } else {
      await withToast(createCard(args), { error: 'Could not create the card' })
    }
  }

  // The autoroll job materializes a series only a window ahead, so a long
  // horizon forecasts occurrences the board has no cards for. Each column says
  // how many, rather than letting the gap against the charts look like a bug.
  const forecasts = forecastByStatus(withinHorizon, horizonDays)

  const boardIsEmpty = cards !== undefined && cards.length === 0

  // Rendered either as full-width bands (below `wide`) or stacked in the
  // sticky rail beside the board (at `wide`).
  const cashFlowEl = (
    <CashFlowChart
      cards={withinHorizon}
      horizonDays={horizonDays}
      money={money}
      scenarioCards={scenarioCards}
    />
  )
  const categoryEl = (
    <CategoryChart
      cards={withinHorizon}
      horizonDays={horizonDays}
      money={money}
      budgetsByCategory={budgetsByCategory}
    />
  )
  const outflowEl = <OutflowChart cards={withinHorizon} horizonDays={horizonDays} money={money} />
  const hasBudgets = Boolean(budgets?.budgets.length)
  const budgetEl = budgets?.budgets.length ? (
    <BudgetPanel budgets={budgets.budgets} money={money} />
  ) : null
  const completedCount = (cards ?? []).filter((c) => isCompleted(c.status)).length
  const allCategories = categories ? [...categories.expense, ...categories.income] : []

  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 pb-16 xl:max-w-350 2xl:max-w-none 2xl:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Budget Board
          </p>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            Your cash flow, one card at a time
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground">
            Horizon
            <Select
              value={String(horizonDays)}
              onValueChange={(value) =>
                value &&
                void withToast(saveSettings({ horizonDays: Number(value) }), {
                  error: 'Could not save your horizon',
                })
              }
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HORIZON_OPTIONS.map((o) => (
                  <SelectItem key={o.days} value={String(o.days)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>

          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="sm"
                  pressed={showCompleted}
                  onPressedChange={(pressed) =>
                    void withToast(saveSettings({ showCompleted: pressed }), {
                      error: 'Could not save that setting',
                    })
                  }
                  aria-label={showCompleted ? 'Hide completed' : 'Show completed'}
                />
              }
            >
              <CheckCheck />
            </TooltipTrigger>
            <TooltipContent>{showCompleted ? 'Hide completed' : 'Show completed'}</TooltipContent>
          </Tooltip>

          <NotificationsBell
            cards={cards ?? []}
            money={money}
            dismissed={dismissedAlerts ?? []}
            open={alertsOpen}
            onOpenChange={setAlertsOpen}
            onDismiss={(alertIds) =>
              void withToast(dismissAlerts({ alertIds }), {
                error: 'Could not dismiss that alert',
              })
            }
            onOpenCard={(cardId) => {
              const card = cards?.find((c) => c._id === cardId)
              if (card) setDraft({ card, status: card.status })
            }}
          />

          <Button size="sm" onClick={() => setDraft({ status: 'upcoming' })}>
            <Plus size={16} /> New card
          </Button>

          <Button variant="secondary" size="sm" onClick={() => setAssistantOpen(true)}>
            <Bot size={16} /> Ask AI
          </Button>
        </div>
      </div>

      {!boardIsEmpty ? (
        <div className="mb-4">
          <InsightsBanner
            insights={insights}
            refreshing={refreshingInsights}
            onDismiss={(id) =>
              void withToast(dismissInsight({ id: id as Id<'insights'> }), {
                error: 'Could not dismiss that',
              })
            }
            onRefresh={() => {
              setRefreshingInsights(true)
              void withToast(refreshInsights({}), { error: 'Could not refresh' }).finally(() =>
                // The briefing is generated in the background; the spinner is
                // a hint that something is happening, not a completion signal.
                setTimeout(() => setRefreshingInsights(false), 4000),
              )
            }}
            onShowCards={(cardIds) => {
              const named = (cards ?? []).filter((c) => cardIds.includes(c._id))
              const uniqueCategories = [...new Set(named.map((c) => c.category))]
              setFilters(
                uniqueCategories.length === 1
                  ? { categories: uniqueCategories }
                  : { search: named[0]?.description ?? '' },
              )
            }}
          />
        </div>
      ) : null}

      <div className="mb-4">
        <StatsBar stats={stats} horizonDays={horizonDays} money={money} />
      </div>

      {!boardIsEmpty ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant={scenarioOpen || isScenarioActive(scenario) ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setScenarioOpen((open) => !open)}
          >
            <FlaskConical size={15} />
            What if
          </Button>

          {completedCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={archiving}
              onClick={() => setArchiveConfirmOpen(true)}
            >
              {archiving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
              Close out {completedCount} completed
            </Button>
          ) : null}
        </div>
      ) : null}

      {scenarioOpen && cards ? (
        <div className="mb-4">
          <ScenarioPanel
            cards={withinHorizon}
            scenario={scenario}
            horizonDays={horizonDays}
            categories={categories?.expense ?? []}
            money={money}
            onChange={setScenario}
            onClose={() => setScenarioOpen(false)}
          />
        </div>
      ) : null}

      {!boardIsEmpty ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2 2xl:hidden">
          {cashFlowEl}
          {hasBudgets ? budgetEl : categoryEl}
        </div>
      ) : null}

      {!boardIsEmpty ? (
        <div className={`mb-6 grid gap-4 2xl:hidden ${hasBudgets ? 'lg:grid-cols-2' : ''}`}>
          {outflowEl}
          {hasBudgets ? categoryEl : null}
        </div>
      ) : null}

      {boardIsEmpty ? (
        <div className="mb-6 rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <h2 className="text-base font-semibold text-foreground">Your board is empty</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Tell the assistant something like “rent $1200 due on the 15th” and it will fill the
            board in for you — or add the first card yourself.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={() => setAssistantOpen(true)}>
              <Bot size={16} /> Ask the assistant
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDraft({ status: 'upcoming' })}>
              <Plus size={16} /> Add a card
            </Button>
          </div>
        </div>
      ) : null}

      <div className="2xl:flex 2xl:items-start 2xl:gap-6">
        <div className="2xl:min-w-0 2xl:flex-1">
          {!boardIsEmpty ? (
            <div className="mb-4">
              <BoardFilterBar
                filters={filters}
                categories={allCategories}
                onChange={setFilters}
                matchCount={visible.length}
                totalCount={withinHorizon.length}
              />
            </div>
          ) : null}

          {cards === undefined ? (
            <p className="text-sm text-muted-foreground">Loading your board…</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setActiveCard(null)}
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
                          onAdd={() => setDraft({ status: column.status })}
                          onOpen={(card) => setDraft({ card, status: card.status })}
                          forecast={forecasts.get(column.status)}
                          onDelete={(card) => setCardToDelete(card)}
                          onDuplicate={(card) => {
                            void withUndo(duplicateCard({ id: card._id as Id<'cards'> }), {
                              error: 'Could not copy that card',
                              message: `Copied "${card.description}" forward`,
                              undo: (id) => removeCard({ id }),
                            })
                          }}
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
          )}

          {visible.length === 0 && !boardIsEmpty && hasActiveFilters(filters) ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              No cards match those filters.
            </p>
          ) : null}
        </div>

        {!boardIsEmpty ? (
          <aside className="hidden 2xl:sticky 2xl:top-6 2xl:block 2xl:w-142.5 2xl:shrink-0">
            <div className="flex flex-col gap-4">
              {cashFlowEl}
              {outflowEl}
              {budgetEl}
              {categoryEl}
            </div>
          </aside>
        ) : null}
      </div>

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

      <AlertDialog
        open={cardToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setCardToDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete card</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{cardToDelete?.description}"? You'll have a moment to undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!cardToDelete) return
                const doomed = cardToDelete
                void withUndo(removeCard({ id: doomed._id as Id<'cards'> }), {
                  error: 'Could not delete that card',
                  message: `Deleted "${doomed.description}"`,
                  // The mutation hands back the whole document, so undo puts
                  // the card back verbatim rather than approximating it.
                  undo: (card) => restoreCard({ card }),
                })
                setCardToDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive completed cards</AlertDialogTitle>
            <AlertDialogDescription>
              Archive {completedCount} completed card{completedCount === 1 ? '' : 's'}? You'll have
              a moment to undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setArchiveConfirmOpen(false)
                setArchiving(true)
                void withUndo(archiveCompleted({}), {
                  error: 'Could not archive',
                  message: (r) =>
                    `Archived ${r.archived} completed card${r.archived === 1 ? '' : 's'}`,
                  undo: (r) => unarchiveMany({ ids: r.archivedIds }),
                }).finally(() => setArchiving(false))
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
