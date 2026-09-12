import { useState } from 'react'
import { FlaskConical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  cardCents,
  formatCents,
  formatDate,
  fromDateInput,
  isCompleted,
  toCents,
  toDateInput,
} from '#/lib/board'
import { compareScenario, isScenarioActive } from '#/lib/scenario'
import type { Card as BoardCard, CardType, MoneyFormat } from '#/lib/board'
import type { DraftCard, Scenario } from '#/lib/scenario'

/**
 * "What if" for the board.
 *
 * Nothing in here is written to the database. The user mutes real cards and
 * adds hypothetical ones, and the panel answers the only question that
 * matters when money is tight: does what comes in still cover what goes out.
 */
export default function ScenarioPanel({
  cards,
  scenario,
  horizonDays,
  categories,
  money,
  onChange,
  onClose,
}: {
  cards: Array<BoardCard>
  scenario: Scenario
  horizonDays: number
  categories: Array<string>
  money?: MoneyFormat
  onChange: (next: Scenario) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({
    description: '',
    amount: '',
    type: 'expense' as CardType,
    date: toDateInput(Date.now()),
    recurringMonthly: true,
  })

  const comparison = compareScenario(cards, scenario, horizonDays)
  const active = isScenarioActive(scenario)
  const muted = new Set(scenario.mutedCardIds)

  const open = cards
    .filter((c) => !isCompleted(c.status))
    .sort((a, b) => cardCents(b) - cardCents(a))
    .slice(0, 30)

  function addDraft() {
    const cents = toCents(draft.amount)
    if (!draft.description.trim() || cents <= 0) return

    const date = fromDateInput(draft.date)
    const newDraft: DraftCard = {
      id: `draft:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      type: draft.type,
      description: draft.description.trim(),
      amountCents: cents,
      date,
      category: categories[0] ?? 'Other',
      recurring: draft.recurringMonthly,
      recurrence: draft.recurringMonthly
        ? { frequency: 'monthly', interval: 1, dayOfMonth: new Date(date).getDate() }
        : undefined,
    }

    onChange({ ...scenario, drafts: [...scenario.drafts, newDraft] })
    setDraft((d) => ({ ...d, description: '', amount: '' }))
  }

  const delta = comparison.deltaCents
  const scenarioNet = comparison.scenario.netCents

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          <FlaskConical size={14} className="text-primary" />
          What if
        </CardTitle>
        <div className="flex gap-1">
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ mutedCardIds: [], drafts: [] })}
            >
              <RotateCcw size={13} />
              Reset
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Figure
            label={`Income · ${horizonDays}d`}
            value={formatCents(comparison.scenario.incomeCents, money)}
            baseline={
              comparison.scenario.incomeCents !== comparison.baseline.incomeCents
                ? formatCents(comparison.baseline.incomeCents, money)
                : undefined
            }
            tone="good"
          />
          <Figure
            label={`Expenses · ${horizonDays}d`}
            value={formatCents(comparison.scenario.expenseCents, money)}
            baseline={
              comparison.scenario.expenseCents !== comparison.baseline.expenseCents
                ? formatCents(comparison.baseline.expenseCents, money)
                : undefined
            }
          />
          <Figure
            label="Left over"
            value={formatCents(scenarioNet, money)}
            baseline={
              delta !== 0
                ? `${delta > 0 ? '+' : ''}${formatCents(delta, money)} vs today`
                : undefined
            }
            tone={scenarioNet >= 0 ? 'good' : 'bad'}
          />
        </div>

        {scenarioNet < 0 ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            This leaves you {formatCents(Math.abs(scenarioNet), money)} short over the next{' '}
            {horizonDays} days.
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Add a hypothetical
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Label className="flex flex-1 flex-col items-start gap-1 text-xs">
              What
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Car payment"
                className="h-8"
              />
            </Label>
            <Label className="flex w-24 flex-col items-start gap-1 text-xs">
              Amount
              <Input
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                inputMode="decimal"
                placeholder="400"
                className="h-8"
              />
            </Label>
            <Label className="flex w-28 flex-col items-start gap-1 text-xs">
              Type
              <Select
                value={draft.type}
                onValueChange={(value) => value && setDraft({ ...draft, type: value as CardType })}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </Label>
            <Label className="flex w-36 flex-col items-start gap-1 text-xs">
              Starting
              <Input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                className="h-8"
              />
            </Label>
            <Label className="flex items-center gap-1.5 pb-1.5 text-xs">
              <Checkbox
                checked={draft.recurringMonthly}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, recurringMonthly: checked === true })
                }
              />
              Monthly
            </Label>
            <Button
              size="sm"
              onClick={addDraft}
              disabled={!draft.description.trim() || !draft.amount}
            >
              <Plus size={14} />
              Add
            </Button>
          </div>
        </div>

        {scenario.drafts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {scenario.drafts.map((d) => (
              <Badge key={d.id} variant="secondary" className="gap-1.5 py-1">
                <span
                  className={d.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : ''}
                >
                  {d.type === 'income' ? '+' : '−'}
                  {formatCents(d.amountCents, money)}
                </span>
                {d.description}
                <span className="text-muted-foreground">
                  {d.recurring ? 'monthly' : formatDate(d.date)}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${d.description}`}
                  onClick={() =>
                    onChange({ ...scenario, drafts: scenario.drafts.filter((x) => x.id !== d.id) })
                  }
                  className="text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 size={12} />
                </button>
              </Badge>
            ))}
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Turn things off
          </p>
          <div className="grid max-h-56 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {open.map((card) => {
              const off = muted.has(card._id)
              return (
                <label
                  key={card._id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition',
                    off
                      ? 'border-dashed border-border bg-muted/40 text-muted-foreground line-through'
                      : 'border-border bg-card',
                  )}
                >
                  <Checkbox
                    checked={!off}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...scenario,
                        mutedCardIds:
                          checked === true
                            ? scenario.mutedCardIds.filter((id) => id !== card._id)
                            : [...scenario.mutedCardIds, card._id],
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{card.description}</span>
                  <span
                    className={cn(
                      'shrink-0 tabular-nums',
                      card.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : '',
                    )}
                  >
                    {card.type === 'income' ? '+' : ''}
                    {formatCents(cardCents(card), money)}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Figure({
  label,
  value,
  baseline,
  tone = 'neutral',
}: {
  label: string
  value: string
  baseline?: string
  tone?: 'neutral' | 'good' | 'bad'
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          'text-base font-bold tabular-nums',
          tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </p>
      {baseline ? <p className="text-[11px] text-muted-foreground">{baseline}</p> : null}
    </div>
  )
}
