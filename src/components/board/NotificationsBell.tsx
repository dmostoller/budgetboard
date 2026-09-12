import { useMemo } from 'react'
import { AlertTriangle, Bell, CalendarClock, Check, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { buildAlerts } from '#/lib/notifications'
import type { Alert, AlertKind } from '#/lib/notifications'
import type { Card, MoneyFormat } from '#/lib/board'

const ICON: Record<AlertKind, React.ReactNode> = {
  overdue: <AlertTriangle size={15} className="text-destructive" />,
  'due-today': <Clock size={15} className="text-amber-600 dark:text-amber-400" />,
  'due-soon': <CalendarClock size={15} className="text-primary" />,
  'income-late': <Clock size={15} className="text-muted-foreground" />,
}

export default function NotificationsBell({
  cards,
  money,
  dismissed,
  open,
  onOpenChange,
  onDismiss,
  onOpenCard,
}: {
  cards: Array<Card>
  money?: MoneyFormat
  /** Dismissed alert ids, stored server-side so they follow the user. */
  dismissed: Array<string>
  open: boolean
  onOpenChange: (open: boolean) => void
  onDismiss: (alertIds: Array<string>) => void
  onOpenCard: (cardId: string) => void
}) {
  const alerts = useMemo(() => buildAlerts(cards, Date.now(), money), [cards, money])
  const visible = alerts.filter((a) => !dismissed.includes(a.id))

  const dismiss = (alert: Alert) => onDismiss([alert.id])
  const dismissAll = () => onDismiss(visible.map((a) => a.id))

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`Notifications (${visible.length})`}
          />
        }
      >
        <Bell />
        {visible.length > 0 ? (
          <Badge
            variant="destructive"
            className="absolute -top-1 -right-1 h-4 min-w-4 justify-center rounded-full bg-destructive px-1 text-[10px] text-white"
          >
            {visible.length > 9 ? '9+' : visible.length}
          </Badge>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Reminders</h2>
          {visible.length > 0 ? (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={dismissAll}>
              Clear all
            </Button>
          ) : null}
        </header>

        {visible.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <Check size={16} className="text-emerald-600 dark:text-emerald-400" />
            Nothing needs your attention.
          </p>
        ) : (
          <ul className="max-h-[60vh] overflow-y-auto">
            {visible.map((alert) => (
              <li
                key={alert.id}
                className="flex items-start gap-2 border-b border-border px-4 py-3 last:border-0"
              >
                <span className="mt-0.5">{ICON[alert.kind]}</span>
                <button
                  type="button"
                  onClick={() => {
                    onOpenCard(alert.cardId)
                    onOpenChange(false)
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-foreground">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">{alert.detail}</p>
                </button>
                <button
                  type="button"
                  onClick={() => dismiss(alert)}
                  aria-label={`Dismiss ${alert.title}`}
                  className="mt-0.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Check size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
