import type { ReactNode } from 'react'
import StatsBar, { type BoardStats } from './StatsBar'
import BoardFilterBar from './BoardFilterBar'
import ScenarioPanel from './ScenarioPanel'
import BoardInsights from './BoardInsights'
import BoardToolbar from './BoardToolbar'
import EmptyBoardState from './EmptyBoardState'
import BoardLanes from './BoardLanes'
import { BoardChartBands, BoardChartRail } from './BoardCharts'
import { isScenarioActive } from '#/lib/scenario'
import { forecastByStatus } from '#/lib/board'
import type { BoardFilters, Card, CardStatus, MoneyFormat } from '#/lib/board'
import type { Scenario } from '#/lib/scenario'
import type { DragEndEvent, DragStartEvent, SensorDescriptor, SensorOptions } from '@dnd-kit/core'

type Categories = { expense: Array<string>; income: Array<string> } | undefined
type Insights = Parameters<typeof BoardInsights>[0]['insights']

type BoardMainProps = {
  boardIsEmpty: boolean
  insights: Insights
  refreshingInsights: boolean
  cards: Array<Card> | undefined
  onDismissInsight: (id: string) => void
  onRefreshInsights: () => void
  onFilterToCards: (categories: Array<string>, fallbackSearch: string) => void
  stats: BoardStats | undefined
  horizonDays: number
  money: MoneyFormat
  scenarioOpen: boolean
  scenario: Scenario
  onToggleScenario: () => void
  onChangeScenario: (scenario: Scenario) => void
  onCloseScenario: () => void
  completedCount: number
  archiving: boolean
  onOpenArchiveConfirm: () => void
  categories: Categories
  withinHorizon: Array<Card>
  cashFlowEl: ReactNode
  categoryEl: ReactNode
  outflowEl: ReactNode
  budgetEl: ReactNode
  hasBudgets: boolean
  onOpenAssistant: () => void
  onNewCard: () => void
  filters: BoardFilters
  allCategories: Array<string>
  onChangeFilters: (filters: BoardFilters) => void
  visibleCount: number
  sensors: Array<SensorDescriptor<SensorOptions>>
  activeCard: Card | null
  onDragStart: (event: DragStartEvent) => void
  onDragEnd: (event: DragEndEvent) => void
  onDragCancel: () => void
  byStatus: Map<CardStatus, Array<Card>>
  forecasts: ReturnType<typeof forecastByStatus>
  onAddCard: (status: CardStatus) => void
  onOpenCard: (card: Card) => void
  onDeleteCard: (card: Card) => void
  onDuplicateCard: (card: Card) => void
  noMatches: boolean
}

export default function BoardMain({
  boardIsEmpty,
  insights,
  refreshingInsights,
  cards,
  onDismissInsight,
  onRefreshInsights,
  onFilterToCards,
  stats,
  horizonDays,
  money,
  scenarioOpen,
  scenario,
  onToggleScenario,
  onChangeScenario,
  onCloseScenario,
  completedCount,
  archiving,
  onOpenArchiveConfirm,
  categories,
  withinHorizon,
  cashFlowEl,
  categoryEl,
  outflowEl,
  budgetEl,
  hasBudgets,
  onOpenAssistant,
  onNewCard,
  filters,
  allCategories,
  onChangeFilters,
  visibleCount,
  sensors,
  activeCard,
  onDragStart,
  onDragEnd,
  onDragCancel,
  byStatus,
  forecasts,
  onAddCard,
  onOpenCard,
  onDeleteCard,
  onDuplicateCard,
  noMatches,
}: BoardMainProps) {
  if (boardIsEmpty) {
    return (
      <>
        <div className="mb-4">
          <StatsBar stats={stats} horizonDays={horizonDays} money={money} />
        </div>
        <EmptyBoardState onOpenAssistant={onOpenAssistant} onNewCard={onNewCard} />
      </>
    )
  }

  return (
    <>
      <BoardInsights
        insights={insights}
        refreshing={refreshingInsights}
        cards={cards}
        onDismiss={onDismissInsight}
        onRefresh={onRefreshInsights}
        onFilterToCards={onFilterToCards}
      />

      <div className="mb-4">
        <StatsBar stats={stats} horizonDays={horizonDays} money={money} />
      </div>

      <BoardToolbar
        scenarioActive={scenarioOpen || isScenarioActive(scenario)}
        onToggleScenario={onToggleScenario}
        completedCount={completedCount}
        archiving={archiving}
        onArchiveCompleted={onOpenArchiveConfirm}
      />

      {scenarioOpen && cards ? (
        <div className="mb-4">
          <ScenarioPanel
            cards={withinHorizon}
            scenario={scenario}
            horizonDays={horizonDays}
            categories={categories?.expense ?? []}
            money={money}
            onChange={onChangeScenario}
            onClose={onCloseScenario}
          />
        </div>
      ) : null}

      <BoardChartBands
        cashFlowEl={cashFlowEl}
        categoryEl={categoryEl}
        outflowEl={outflowEl}
        budgetEl={budgetEl}
        hasBudgets={hasBudgets}
      />

      <div className="2xl:flex 2xl:items-start 2xl:gap-6">
        <div className="2xl:min-w-0 2xl:flex-1">
          <div className="mb-4">
            <BoardFilterBar
              filters={filters}
              categories={allCategories}
              onChange={onChangeFilters}
              matchCount={visibleCount}
              totalCount={withinHorizon.length}
            />
          </div>

          {cards === undefined ? (
            <p className="text-sm text-muted-foreground">Loading your board…</p>
          ) : (
            <BoardLanes
              sensors={sensors}
              activeCard={activeCard}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
              byStatus={byStatus}
              forecasts={forecasts}
              money={money}
              onAddCard={onAddCard}
              onOpenCard={onOpenCard}
              onDeleteCard={onDeleteCard}
              onDuplicateCard={onDuplicateCard}
            />
          )}

          {noMatches ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              No cards match those filters.
            </p>
          ) : null}
        </div>

        <BoardChartRail
          cashFlowEl={cashFlowEl}
          categoryEl={categoryEl}
          outflowEl={outflowEl}
          budgetEl={budgetEl}
        />
      </div>
    </>
  )
}
