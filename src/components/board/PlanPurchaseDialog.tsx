import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  cardCents,
  formatCents,
  fromDateInput,
  isCompleted,
  statusLabel,
  toDateInput,
} from '#/lib/board'
import type { Card, CardStatus, MoneyFormat } from '#/lib/board'

/**
 * Taking a card off the wishlist.
 *
 * A wishlist date is "want by", which is not the same thing as a due date,
 * so the card does not simply keep it: this asks when the money will actually
 * move. Paying outright defaults to today; planning defaults to the wish date
 * if that is still ahead.
 */
export default function PlanPurchaseDialog({
  card,
  status,
  money,
  onClose,
  onConfirm,
}: {
  card: Card
  status: CardStatus
  money?: MoneyFormat
  onClose: () => void
  onConfirm: (date: number) => void
}) {
  const bought = isCompleted(status)
  const [date, setDate] = useState(() => {
    const now = Date.now()
    return toDateInput(!bought && status === 'upcoming' && card.date > now ? card.date : now)
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{bought ? 'When did you buy it?' : 'When will you buy it?'}</DialogTitle>
          <DialogDescription>
            {card.description} · {formatCents(cardCents(card), money)} moves to{' '}
            {statusLabel(status)} and starts counting toward your totals.
          </DialogDescription>
        </DialogHeader>
        <Label className="flex flex-col items-start gap-1">
          Date
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!date} onClick={() => onConfirm(fromDateInput(date))}>
            Move to {statusLabel(status)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
