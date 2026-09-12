import { Lightbulb, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface Insight {
  _id: string
  headline: string
  detail: string
  cardIds: Array<string>
}

/**
 * The assistant speaking first.
 *
 * One observation at a time, dismissible, and always tied to cards the user
 * can jump straight to — a briefing nobody can act on is just another badge
 * to clear.
 */
export default function InsightsBanner({
  insights,
  onDismiss,
  onRefresh,
  onShowCards,
  refreshing,
}: {
  insights: Array<Insight> | undefined
  onDismiss: (id: string) => void
  onRefresh: () => void
  onShowCards: (cardIds: Array<string>) => void
  refreshing?: boolean
}) {
  const insight = insights?.[0]
  if (!insight) return null

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3">
      <Lightbulb size={18} className="mt-0.5 shrink-0 text-primary" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{insight.headline}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{insight.detail}</p>

        <div className="mt-2 flex flex-wrap gap-2">
          {insight.cardIds.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => onShowCards(insight.cardIds)}>
              Show {insight.cardIds.length} card{insight.cardIds.length === 1 ? '' : 's'}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Looking…' : 'Look again'}
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(insight._id)}
        aria-label="Dismiss insight"
        className="mt-0.5 shrink-0 text-muted-foreground transition hover:text-foreground"
      >
        <X size={15} />
      </button>
    </div>
  )
}
