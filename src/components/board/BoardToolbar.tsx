import { Archive, FlaskConical, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The row of board-wide actions above the columns: toggling the
 * what-if scenario panel, and clearing out completed cards in bulk. */
export default function BoardToolbar({
  scenarioActive,
  onToggleScenario,
  completedCount,
  archiving,
  onArchiveCompleted,
}: {
  scenarioActive: boolean
  onToggleScenario: () => void
  completedCount: number
  archiving: boolean
  onArchiveCompleted: () => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button
        variant={scenarioActive ? 'default' : 'secondary'}
        size="sm"
        onClick={onToggleScenario}
      >
        <FlaskConical size={15} />
        What if
      </Button>

      {completedCount > 0 ? (
        <Button variant="ghost" size="sm" disabled={archiving} onClick={onArchiveCompleted}>
          {archiving ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />}
          Close out {completedCount} completed
        </Button>
      ) : null}
    </div>
  )
}
