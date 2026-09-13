import { Bot, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** What a brand-new board shows instead of empty columns: a nudge toward
 * the assistant, with manual entry as the fallback. */
export default function EmptyBoardState({
  onOpenAssistant,
  onNewCard,
}: {
  onOpenAssistant: () => void
  onNewCard: () => void
}) {
  return (
    <div className="mb-6 rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-foreground">Your board is empty</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Tell the assistant something like “rent $1200 due on the 15th” and it will fill the board in
        for you — or add the first card yourself.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button size="sm" onClick={onOpenAssistant}>
          <Bot size={16} /> Ask the assistant
        </Button>
        <Button variant="secondary" size="sm" onClick={onNewCard}>
          <Plus size={16} /> Add a card
        </Button>
      </div>
    </div>
  )
}
