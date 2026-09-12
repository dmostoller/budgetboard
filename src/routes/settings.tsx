import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { useForm } from '@tanstack/react-form'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { z } from 'zod'
import { api } from '../../convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CURRENCY_OPTIONS, HORIZON_OPTIONS, centsToInput, formatCents, toCents } from '#/lib/board'
import { fieldErrorMessage } from '#/lib/form'
import { pushToast, withToast } from '#/lib/toast'
import { useUserId } from '#/lib/user'
import type { CardType } from '#/lib/board'
import type { Id } from '../../convex/_generated/dataModel'

export const Route = createFileRoute('/settings')({ component: Settings })

function FieldError({ errors }: { errors: Array<unknown> }) {
  const message = fieldErrorMessage(errors)
  if (!message) return null
  return <span className="text-xs text-destructive">{message}</span>
}

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(40, 'Keep it short'),
  type: z.enum(['income', 'expense']),
})

function Settings() {
  const { userId, isPending, user } = useUserId()

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    )
  }

  if (!userId) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <p className="text-sm text-muted-foreground">
          <Link
            to="/signin"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>{' '}
          to change your settings.
        </p>
      </main>
    )
  }

  return <SettingsForm email={user?.email} />
}

function SettingsForm({ email }: { email?: string | null }) {
  const settings = useQuery(api.settings.get, {})
  const categories = useQuery(api.categories.list, {})
  const budgets = useQuery(api.budgets.progress, {})
  const setBudget = useMutation(api.budgets.set)
  const removeBudget = useMutation(api.budgets.remove)
  const [categoryToRemove, setCategoryToRemove] = useState<{
    _id: Id<'categories'>
    name: string
  } | null>(null)
  const saveSettings = useMutation(api.settings.set)
  const addCategory = useMutation(api.categories.add)
  const removeCategory = useMutation(api.categories.remove)

  const form = useForm({
    defaultValues: { name: '', type: 'expense' as CardType },
    validators: { onSubmit: categorySchema },
    onSubmit: async ({ value, formApi }) => {
      const created = await withToast(addCategory({ name: value.name, type: value.type }), {
        error: 'Could not add that category',
      })
      if (created) {
        pushToast(`Added “${value.name.trim()}”`)
        formApi.reset()
      }
    },
  })

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12">
      <Button variant="link" className="mb-4 px-0" render={<Link to="/" />}>
        <ArrowLeft size={15} /> Back to the board
      </Button>

      <h1 className="mb-6 text-2xl font-bold text-foreground">Settings</h1>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Board
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Label className="flex flex-col items-start gap-1">
            <span className="font-medium text-foreground">Time horizon</span>
            <span className="text-xs font-normal text-muted-foreground">
              How far ahead the board and the totals look.
            </span>
            <Select
              value={String(settings?.horizonDays ?? 30)}
              onValueChange={(value) =>
                void withToast(saveSettings({ horizonDays: Number(value) }), {
                  error: 'Could not save your horizon',
                })
              }
            >
              <SelectTrigger className="mt-1">
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

          <Label className="flex flex-col items-start gap-1">
            <span className="font-medium text-foreground">Currency</span>
            <span className="text-xs font-normal text-muted-foreground">
              Used everywhere amounts are shown.
            </span>
            <Select
              value={settings?.currency ?? 'USD'}
              onValueChange={(value) =>
                value &&
                void withToast(saveSettings({ currency: value }), {
                  error: 'Could not save your currency',
                })
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>

          <div className="flex flex-col gap-3">
            <Label>
              <Switch
                checked={settings?.showCompleted ?? true}
                onCheckedChange={(checked) =>
                  void withToast(saveSettings({ showCompleted: checked }), {
                    error: 'Could not save that setting',
                  })
                }
              />
              Show paid and received cards
            </Label>

            <Label>
              <Switch
                checked={settings?.insightsEnabled ?? true}
                onCheckedChange={(checked) =>
                  void withToast(saveSettings({ insightsEnabled: checked }), {
                    error: 'Could not save that setting',
                  })
                }
              />
              Weekly briefing from the assistant
            </Label>
          </div>
        </CardContent>
      </Card>

      <BudgetSettings
        budgets={budgets?.budgets}
        categories={categories?.expense ?? []}
        currency={settings?.currency ?? 'USD'}
        locale={settings?.locale ?? 'en-US'}
        onSet={(category, limitCents) =>
          withToast(setBudget({ category, limitCents }), { error: 'Could not save that budget' })
        }
        onRemove={(id) =>
          withToast(removeBudget({ id: id as Id<'budgets'> }), {
            error: 'Could not remove that budget',
          })
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Categories
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The built-in categories are always available. Anything you add here shows up in the card
            editor and in the assistant’s suggestions.
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void form.handleSubmit()
            }}
            className="mb-5 flex flex-wrap items-start gap-2"
          >
            <form.Field name="name">
              {(field) => (
                <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                  <Input
                    placeholder="New category"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>

            <form.Field name="type">
              {(field) => (
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as CardType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </form.Field>

            <Button type="submit">Add</Button>
          </form>

          {categories === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {(['expense', 'income'] as Array<CardType>).map((type) => (
                <div key={type}>
                  <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {type}
                  </h3>
                  <ul className="flex flex-wrap gap-1.5">
                    {categories[type].map((name) => {
                      const custom = categories.custom.find(
                        (c) => c.type === type && c.name === name,
                      )
                      return (
                        <li key={name}>
                          <Badge variant="secondary" className="gap-1.5">
                            {name}
                            {custom ? (
                              <button
                                type="button"
                                aria-label={`Remove ${name}`}
                                onClick={() => setCategoryToRemove(custom)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 size={12} />
                              </button>
                            ) : null}
                          </Badge>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">{email ?? 'Signed in'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Cards, categories and settings are stored per account. Removing a custom category moves
            the cards filed under it to another category rather than leaving them pointing at a name
            that no longer exists.
          </p>
        </CardContent>
      </Card>

      {categoryToRemove ? (
        <RemoveCategoryDialog
          category={categoryToRemove}
          options={(categories?.expense ?? [])
            .concat(categories?.income ?? [])
            .filter((n) => n !== categoryToRemove.name)}
          onClose={() => setCategoryToRemove(null)}
          onConfirm={async (reassignTo) => {
            const result = await withToast(
              removeCategory({ id: categoryToRemove._id, reassignTo }),
              { error: 'Could not remove that category' },
            )
            if (result) {
              pushToast(
                result.reassigned > 0
                  ? `Removed “${categoryToRemove.name}” and moved ${result.reassigned} card${
                      result.reassigned === 1 ? '' : 's'
                    } to ${result.reassignedTo}`
                  : `Removed “${categoryToRemove.name}”`,
              )
            }
            setCategoryToRemove(null)
          }}
        />
      ) : null}
    </main>
  )
}

/**
 * Deleting a category is not just deleting a row: the cards filed under it
 * would keep a name the picker can no longer offer. The dialog makes the
 * reassignment an explicit choice rather than a silent default.
 */
function RemoveCategoryDialog({
  category,
  options,
  onClose,
  onConfirm,
}: {
  category: { _id: Id<'categories'>; name: string }
  options: Array<string>
  onClose: () => void
  onConfirm: (reassignTo: string) => Promise<void>
}) {
  const usage = useQuery(api.categories.usage, { name: category.name })
  const [reassignTo, setReassignTo] = useState(options.includes('Other') ? 'Other' : options[0])
  const [saving, setSaving] = useState(false)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove “{category.name}”</DialogTitle>
        </DialogHeader>

        {usage === undefined ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : usage.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is filed under this category, so removing it changes nothing else.
          </p>
        ) : (
          <Label className="flex flex-col items-start gap-1">
            <span className="text-sm font-normal text-muted-foreground">
              {usage.count} card{usage.count === 1 ? '' : 's'} use this category. Move{' '}
              {usage.count === 1 ? 'it' : 'them'} to:
            </span>
            <Select value={reassignTo} onValueChange={(value) => value && setReassignTo(value)}>
              <SelectTrigger className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={saving}
            onClick={() => {
              setSaving(true)
              void onConfirm(reassignTo).finally(() => setSaving(false))
            }}
          >
            {saving ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface BudgetRow {
  _id: string
  category: string
  limitCents: number
  spentCents: number
  projectedCents: number
  remainingCents: number
}

/**
 * Monthly ceilings per expense category. A budget is only useful next to what
 * has actually happened against it, so each row shows the month's projection
 * beside the cap rather than the cap alone.
 */
function BudgetSettings({
  budgets,
  categories,
  currency,
  locale,
  onSet,
  onRemove,
}: {
  budgets: Array<BudgetRow> | undefined
  categories: Array<string>
  currency: string
  locale: string
  onSet: (category: string, limitCents: number) => Promise<unknown>
  onRemove: (id: string) => Promise<unknown>
}) {
  const money = { currency, locale }
  const used = new Set((budgets ?? []).map((b) => b.category))
  const available = categories.filter((c) => !used.has(c))

  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState('')

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Category budgets
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          A monthly ceiling for a category. The board shows what is spent and what is still
          committed against each one, and the assistant will tell you when a budget is heading over.
        </p>
      </CardHeader>

      <CardContent>
        <div className="mb-5 flex flex-wrap items-end gap-2">
          <Label className="flex min-w-[12rem] flex-1 flex-col items-start gap-1 text-xs">
            Category
            <Select
              value={category || undefined}
              onValueChange={(value) => value && setCategory(value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {available.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>

          <Label className="flex w-32 flex-col items-start gap-1 text-xs">
            Monthly cap
            <Input
              value={limit}
              inputMode="decimal"
              placeholder="400"
              onChange={(e) => setLimit(e.target.value)}
            />
          </Label>

          <Button
            disabled={!category || toCents(limit) <= 0}
            onClick={() => {
              void onSet(category, toCents(limit)).then(() => {
                setCategory('')
                setLimit('')
              })
            }}
          >
            Set budget
          </Button>
        </div>

        {budgets === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No budgets yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {budgets.map((budget) => (
              <li
                key={budget._id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {budget.category}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatCents(budget.projectedCents, money)} of{' '}
                  {formatCents(budget.limitCents, money)}
                </span>
                <Input
                  defaultValue={centsToInput(budget.limitCents)}
                  inputMode="decimal"
                  className="h-8 w-24"
                  aria-label={`${budget.category} monthly cap`}
                  onBlur={(e) => {
                    const cents = toCents(e.target.value)
                    if (cents > 0 && cents !== budget.limitCents) {
                      void onSet(budget.category, cents)
                    }
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${budget.category} budget`}
                  onClick={() => void onRemove(budget._id)}
                  className="shrink-0 text-muted-foreground transition hover:text-destructive"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
