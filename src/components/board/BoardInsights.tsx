import InsightsBanner from './InsightsBanner'
import type { Insight } from './InsightsBanner'
import type { Card } from '#/lib/board'

/** Wires the weekly briefing banner to the board's own card list and
 * category filter — showing an insight's cards means "filter to these". */
export default function BoardInsights({
  insights,
  refreshing,
  cards,
  onDismiss,
  onRefresh,
  onFilterToCards,
}: {
  insights: Array<Insight> | undefined
  refreshing: boolean
  cards: Array<Card> | undefined
  onDismiss: (id: string) => void
  onRefresh: () => void
  onFilterToCards: (categories: Array<string>, fallbackSearch: string) => void
}) {
  return (
    <div className="mb-4">
      <InsightsBanner
        insights={insights}
        refreshing={refreshing}
        onDismiss={onDismiss}
        onRefresh={onRefresh}
        onShowCards={(cardIds) => {
          const cardIdSet = new Set(cardIds)
          const named = (cards ?? []).filter((c) => cardIdSet.has(c._id))
          const uniqueCategories = [...new Set(named.map((c) => c.category))]
          onFilterToCards(uniqueCategories, named[0]?.description ?? '')
        }}
      />
    </div>
  )
}
