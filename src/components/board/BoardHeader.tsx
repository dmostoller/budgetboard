import { Bot, CheckCheck, Plus } from 'lucide-react'
import NotificationsBell from './NotificationsBell'
import { Button } from '@/components/ui/button'
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
import { HORIZON_OPTIONS } from '#/lib/board'
import type { Card, MoneyFormat } from '#/lib/board'

/** Title plus the controls that apply to the whole board: horizon, the
 * completed-cards toggle, reminders, and the two ways to add a card. */
export default function BoardHeader({
  horizonDays,
  onHorizonChange,
  showCompleted,
  onShowCompletedChange,
  cards,
  money,
  dismissedAlerts,
  alertsOpen,
  onAlertsOpenChange,
  onDismissAlerts,
  onOpenCard,
  onNewCard,
  onOpenAssistant,
}: {
  horizonDays: number
  onHorizonChange: (days: number) => void
  showCompleted: boolean
  onShowCompletedChange: (pressed: boolean) => void
  cards: Array<Card> | undefined
  money: MoneyFormat
  dismissedAlerts: Array<string> | undefined
  alertsOpen: boolean
  onAlertsOpenChange: (open: boolean) => void
  onDismissAlerts: (alertIds: Array<string>) => void
  onOpenCard: (cardId: string) => void
  onNewCard: () => void
  onOpenAssistant: () => void
}) {
  return (
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
            onValueChange={(value) => value && onHorizonChange(Number(value))}
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
                onPressedChange={onShowCompletedChange}
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
          onOpenChange={onAlertsOpenChange}
          onDismiss={onDismissAlerts}
          onOpenCard={onOpenCard}
        />

        <Button size="sm" onClick={onNewCard}>
          <Plus size={16} /> New card
        </Button>

        <Button variant="secondary" size="sm" onClick={onOpenAssistant}>
          <Bot size={16} /> Ask AI
        </Button>
      </div>
    </div>
  )
}
