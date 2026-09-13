import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import type { ReactFormExtendedApi } from '@tanstack/react-form'
import { z } from 'zod'
import RecurrenceFields from './RecurrenceFields'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LANES,
  cardCents,
  centsToInput,
  fromDateInput,
  toCents,
  toDateInput,
  typeForStatus,
} from '#/lib/board'
import { fieldErrorMessage } from '#/lib/form'
import type { Card, CardPriority, CardStatus, CardType } from '#/lib/board'

const recurrenceSchema = z.object({
  frequency: z.enum(['weekly', 'monthly']),
  interval: z.number().int().min(1),
  weekday: z.number().int().min(0).max(6).optional(),
  // -1 is the "last day of the month" sentinel.
  dayOfMonth: z.number().int().min(-1).max(31).optional(),
  nthWeekday: z
    .object({ ordinal: z.number().int(), weekday: z.number().int().min(0).max(6) })
    .optional(),
  endsAfter: z.number().int().min(1).optional(),
  endsOn: z.number().optional(),
})

const schema = z.object({
  type: z.enum(['income', 'expense']),
  // Held as the typed string so "12.5" round-trips; converted to whole cents
  // on submit, never stored as a float.
  amount: z.string().refine((value) => toCents(value) > 0, 'Enter an amount greater than zero'),
  description: z.string().min(1, 'Description is required'),
  date: z.string().min(1, 'Date is required'),
  category: z.string().min(1, 'Pick a category'),
  priority: z.enum(['low', 'medium', 'high']),
  recurring: z.boolean(),
  recurrence: recurrenceSchema.nullable(),
  source: z.string(),
  notes: z.string(),
  status: z.enum(['upcoming', 'due', 'paid', 'expected', 'received']),
})

export type CardFormValues = z.infer<typeof schema>

export interface CardDraft {
  card?: Card
  status: CardStatus
}

// The generic slots on `useForm`'s return type are all inferred at the call
// site and carry no information the field groups below need — spelling them
// out per-component would just be noise, so they're opaque here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CardForm = ReactFormExtendedApi<
  CardFormValues,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>

export default function CardDialog({
  draft,
  categories,
  onClose,
  onSubmit,
  onAddCategory,
}: {
  draft: CardDraft
  categories: { expense: Array<string>; income: Array<string> }
  onClose: () => void
  onSubmit: (values: CardFormValues) => Promise<void> | void
  onAddCategory: (name: string, type: CardType) => Promise<unknown>
}) {
  const { card } = draft
  const initialType = card?.type ?? typeForStatus(draft.status)
  // `window.prompt` blocks the whole page, cannot be styled, and is silently
  // suppressed in some embedded browsers — a real dialog instead.
  const [newCategoryFor, setNewCategoryFor] = useState<CardType | null>(null)
  const [defaultDate] = useState(() => card?.date ?? Date.now())

  const form = useForm({
    defaultValues: {
      type: initialType,
      amount: card ? centsToInput(cardCents(card)) : '',
      description: card?.description ?? '',
      date: toDateInput(defaultDate),
      category: card?.category ?? categories[initialType][0],
      priority: card?.priority ?? 'medium',
      recurring: card?.recurring ?? false,
      recurrence: card?.recurrence ?? null,
      source: card?.source ?? '',
      notes: card?.notes ?? '',
      status: card?.status ?? draft.status,
    } satisfies CardFormValues,
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await onSubmit(value)
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card ? 'Edit card' : 'New card'}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void form.handleSubmit()
          }}
          className="flex flex-col gap-3"
        >
          <CardIdentityFields form={form} categories={categories} />

          <CardClassificationFields
            form={form}
            categories={categories}
            onRequestNewCategory={setNewCategoryFor}
          />

          <CardRecurringField form={form} />

          <form.Field name="notes">
            {(field) => (
              <Label className="flex flex-col items-start gap-1">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={2}
                  placeholder="Called them, they’re waiving the late fee…"
                  className="text-sm"
                />
              </Label>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
            {([canSubmit, isSubmitting]) => (
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? 'Saving…' : card ? 'Save changes' : 'Add card'}
                </Button>
              </DialogFooter>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>

      {newCategoryFor ? (
        <NewCategoryDialog
          type={newCategoryFor}
          onClose={() => setNewCategoryFor(null)}
          onCreate={async (name) => {
            await onAddCategory(name, newCategoryFor)
            form.setFieldValue('category', name)
            setNewCategoryFor(null)
          }}
        />
      ) : null}
    </Dialog>
  )
}

function CardIdentityFields({
  form,
  categories,
}: {
  form: CardForm
  categories: { expense: Array<string>; income: Array<string> }
}) {
  return (
    <>
      <form.Field name="type">
        {(field) => (
          <div className="grid grid-cols-2 gap-2">
            {(['expense', 'income'] as Array<CardType>).map((type) => (
              <Button
                key={type}
                type="button"
                variant={field.state.value === type ? 'default' : 'outline'}
                className="capitalize"
                onClick={() => {
                  field.handleChange(type)
                  const lane = LANES.find((l) => l.type === type)!
                  form.setFieldValue('status', lane.columns[0].status)
                  if (!categories[type].includes(form.getFieldValue('category'))) {
                    form.setFieldValue('category', categories[type][0])
                  }
                }}
              >
                {type}
              </Button>
            ))}
          </div>
        )}
      </form.Field>

      <form.Field name="description">
        {(field) => (
          <Label className="flex flex-col items-start gap-1">
            Description
            <Input
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="Rent, Netflix, Paycheck…"
            />
            <FieldMessage errors={field.state.meta.errors} />
          </Label>
        )}
      </form.Field>

      <div className="grid grid-cols-2 gap-3">
        <form.Field name="amount">
          {(field) => (
            <Label className="flex flex-col items-start gap-1">
              Amount
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldMessage errors={field.state.meta.errors} />
            </Label>
          )}
        </form.Field>

        <form.Field name="date">
          {(field) => (
            <Label className="flex flex-col items-start gap-1">
              Date
              <Input
                type="date"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
              <FieldMessage errors={field.state.meta.errors} />
            </Label>
          )}
        </form.Field>
      </div>
    </>
  )
}

function CardClassificationFields({
  form,
  categories,
  onRequestNewCategory,
}: {
  form: CardForm
  categories: { expense: Array<string>; income: Array<string> }
  onRequestNewCategory: (type: CardType) => void
}) {
  return (
    <>
      <form.Subscribe selector={(state) => state.values.type}>
        {(type) => (
          <div className="grid grid-cols-2 gap-3">
            <form.Field name="category">
              {(field) => (
                <Label className="flex flex-col items-start gap-1">
                  Category
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => {
                      if (value === null) return
                      if (value === '__new__') {
                        onRequestNewCategory(type)
                        return
                      }
                      field.handleChange(value)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {categories[type].map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ New category…</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldMessage errors={field.state.meta.errors} />
                </Label>
              )}
            </form.Field>

            <form.Field name="status">
              {(field) => (
                <Label className="flex flex-col items-start gap-1">
                  Column
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => value && field.handleChange(value as CardStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(LANES.find((l) => l.type === type) ?? LANES[0]).columns.map((c) => (
                        <SelectItem key={c.status} value={c.status}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Label>
              )}
            </form.Field>
          </div>
        )}
      </form.Subscribe>

      <div className="grid grid-cols-2 gap-3">
        <form.Field name="source">
          {(field) => (
            <Label className="flex flex-col items-start gap-1">
              Source <span className="font-normal text-muted-foreground">(optional)</span>
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Payee or payer"
              />
            </Label>
          )}
        </form.Field>

        <form.Field name="priority">
          {(field) => (
            <Label className="flex flex-col items-start gap-1">
              Priority
              <Select
                value={field.state.value}
                onValueChange={(value) => value && field.handleChange(value as CardPriority)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          )}
        </form.Field>
      </div>
    </>
  )
}

function CardRecurringField({ form }: { form: CardForm }) {
  return (
    <form.Field name="recurring">
      {(field) => (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <Label>
            <Checkbox
              checked={field.state.value}
              onCheckedChange={(checked) => {
                const isRecurring = checked === true
                field.handleChange(isRecurring)
                if (isRecurring && !form.getFieldValue('recurrence')) {
                  const seedDate = new Date(fromDateInput(form.getFieldValue('date')))
                  form.setFieldValue('recurrence', {
                    frequency: 'monthly',
                    interval: 1,
                    dayOfMonth: seedDate.getDate(),
                  })
                }
              }}
            />
            Recurring
          </Label>

          {field.state.value ? (
            <form.Field name="recurrence">
              {(recurrenceField) => (
                <RecurrenceFields
                  value={
                    recurrenceField.state.value ?? {
                      frequency: 'monthly',
                      interval: 1,
                      dayOfMonth: 1,
                    }
                  }
                  anchorDate={form.getFieldValue('date')}
                  onChange={(next) => recurrenceField.handleChange(next)}
                />
              )}
            </form.Field>
          ) : null}
        </div>
      )}
    </form.Field>
  )
}

function NewCategoryDialog({
  type,
  onClose,
  onCreate,
}: {
  type: CardType
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    setSaving(true)
    await onCreate(trimmed).finally(() => setSaving(false))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>New {type} category</DialogTitle>
        </DialogHeader>
        <Label className="flex flex-col items-start gap-1">
          Name
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="Pet care"
          />
        </Label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!name.trim() || saving}>
            {saving ? 'Adding…' : 'Add category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FieldMessage({ errors }: { errors: Array<unknown> }) {
  const message = fieldErrorMessage(errors)
  if (!message) return null
  return <span className="text-xs text-destructive">{message}</span>
}

export function toCardMutationArgs(values: CardFormValues) {
  return {
    type: values.type,
    amountCents: toCents(values.amount),
    description: values.description.trim(),
    date: fromDateInput(values.date),
    category: values.category,
    priority: values.priority,
    recurring: values.recurring,
    recurrence: values.recurring ? (values.recurrence ?? undefined) : undefined,
    source: values.source.trim() || undefined,
    notes: values.notes.trim() || undefined,
    status: values.status,
  }
}
