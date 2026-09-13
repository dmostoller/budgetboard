import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  LAST_DAY_OF_MONTH,
  LAST_WEEK_OF_MONTH,
  WEEKDAYS,
  describeRecurrence,
  fromDateInput,
  toDateInput,
} from '#/lib/board'
import type { Recurrence } from '#/lib/board'

const ORDINALS = [
  { value: '1', label: 'first' },
  { value: '2', label: 'second' },
  { value: '3', label: 'third' },
  { value: '4', label: 'fourth' },
  { value: String(LAST_WEEK_OF_MONTH), label: 'last' },
]

type MonthlyMode = 'day' | 'weekday'
type EndMode = 'never' | 'after' | 'on'

function monthlyMode(value: Recurrence): MonthlyMode {
  return value.nthWeekday ? 'weekday' : 'day'
}

function endMode(value: Recurrence): EndMode {
  if (value.endsAfter !== undefined) return 'after'
  if (value.endsOn !== undefined) return 'on'
  return 'never'
}

/**
 * The repeat rule editor.
 *
 * Two shapes of monthly rule are genuinely different and both are common:
 * "the 15th" and "the second Friday". Rent is the former, a lot of paycheques
 * are the latter, and collapsing them into one control makes one of them
 * impossible to say.
 */
export default function RecurrenceFields({
  value,
  anchorDate,
  onChange,
}: {
  value: Recurrence
  /** The card's own date, used to seed a field the user switches on. */
  anchorDate: string
  onChange: (next: Recurrence) => void
}) {
  const seed = new Date(fromDateInput(anchorDate))
  const mode = monthlyMode(value)
  const ends = endMode(value)

  return (
    <div className="grid grid-cols-2 gap-3 pl-6">
      <RecurrenceFrequencyFields value={value} seed={seed} onChange={onChange} />
      <RecurrenceOnFields value={value} seed={seed} mode={mode} onChange={onChange} />
      <RecurrenceEndsFields value={value} anchorDate={anchorDate} ends={ends} onChange={onChange} />

      <p className="col-span-2 text-xs text-muted-foreground">{describeRecurrence(value)}</p>
    </div>
  )
}

function RecurrenceFrequencyFields({
  value,
  seed,
  onChange,
}: {
  value: Recurrence
  seed: Date
  onChange: (next: Recurrence) => void
}) {
  return (
    <>
      <Label className="flex flex-col items-start gap-1">
        Repeats
        <Select
          value={value.frequency}
          onValueChange={(frequency) => {
            if (!frequency) return
            onChange(
              frequency === 'weekly'
                ? {
                    ...value,
                    frequency: 'weekly',
                    weekday: seed.getDay(),
                    nthWeekday: undefined,
                    dayOfMonth: undefined,
                  }
                : {
                    ...value,
                    frequency: 'monthly',
                    weekday: undefined,
                    dayOfMonth: seed.getDate(),
                  },
            )
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(f: string) => (f === 'weekly' ? 'Weekly' : 'Monthly')}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>
      </Label>

      <Label className="flex flex-col items-start gap-1">
        Every
        <div className="flex w-full items-center gap-2">
          <Input
            type="number"
            min="1"
            max={value.frequency === 'weekly' ? 52 : 24}
            value={value.interval}
            onChange={(e) =>
              onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })
            }
          />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {value.frequency === 'weekly' ? 'week(s)' : 'month(s)'}
          </span>
        </div>
      </Label>
    </>
  )
}

function RecurrenceOnFields({
  value,
  seed,
  mode,
  onChange,
}: {
  value: Recurrence
  seed: Date
  mode: MonthlyMode
  onChange: (next: Recurrence) => void
}) {
  if (value.frequency === 'weekly') {
    return (
      <Label className="col-span-2 flex flex-col items-start gap-1">
        On
        <Select
          value={String(value.weekday ?? seed.getDay())}
          onValueChange={(weekday) => weekday && onChange({ ...value, weekday: Number(weekday) })}
        >
          <SelectTrigger className="w-full">
            <SelectValue>{(weekday: string) => WEEKDAYS[Number(weekday)]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {WEEKDAYS.map((label, index) => (
              <SelectItem key={label} value={String(index)}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Label>
    )
  }

  return (
    <>
      <Label className="col-span-2 flex flex-col items-start gap-1">
        On
        <Select
          value={mode}
          onValueChange={(next) => {
            if (!next) return
            if (next === 'weekday') {
              // Seed from the card's own date so switching modes keeps
              // the same day: "the 9th" becomes "the second Friday".
              const ordinal = Math.min(4, Math.ceil(seed.getDate() / 7))
              onChange({
                ...value,
                dayOfMonth: undefined,
                nthWeekday: { ordinal, weekday: seed.getDay() },
              })
            } else {
              onChange({ ...value, nthWeekday: undefined, dayOfMonth: seed.getDate() })
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(m: string) => (m === 'weekday' ? 'A day of the week' : 'A day of the month')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">A day of the month</SelectItem>
            <SelectItem value="weekday">A day of the week</SelectItem>
          </SelectContent>
        </Select>
      </Label>

      {mode === 'day' ? (
        <Label className="col-span-2 flex flex-col items-start gap-1">
          Day
          <div className="flex w-full items-center gap-2">
            <Input
              type="number"
              min="1"
              max="31"
              disabled={value.dayOfMonth === LAST_DAY_OF_MONTH}
              value={
                value.dayOfMonth === LAST_DAY_OF_MONTH ? '' : (value.dayOfMonth ?? seed.getDate())
              }
              onChange={(e) =>
                onChange({
                  ...value,
                  dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
              <input
                type="checkbox"
                checked={value.dayOfMonth === LAST_DAY_OF_MONTH}
                onChange={(e) =>
                  onChange({
                    ...value,
                    dayOfMonth: e.target.checked ? LAST_DAY_OF_MONTH : seed.getDate(),
                  })
                }
              />
              Last day
            </label>
          </div>
        </Label>
      ) : (
        <>
          <Label className="flex flex-col items-start gap-1">
            Which
            <Select
              value={String(value.nthWeekday?.ordinal ?? 1)}
              onValueChange={(ordinal) =>
                ordinal &&
                onChange({
                  ...value,
                  nthWeekday: {
                    ordinal: Number(ordinal),
                    weekday: value.nthWeekday?.weekday ?? seed.getDay(),
                  },
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(o: string) => ORDINALS.find((x) => x.value === o)?.label ?? o}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ORDINALS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>

          <Label className="flex flex-col items-start gap-1">
            Weekday
            <Select
              value={String(value.nthWeekday?.weekday ?? seed.getDay())}
              onValueChange={(weekday) =>
                weekday &&
                onChange({
                  ...value,
                  nthWeekday: {
                    ordinal: value.nthWeekday?.ordinal ?? 1,
                    weekday: Number(weekday),
                  },
                })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{(w: string) => WEEKDAYS[Number(w)]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((label, index) => (
                  <SelectItem key={label} value={String(index)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
        </>
      )}
    </>
  )
}

function RecurrenceEndsFields({
  value,
  anchorDate,
  ends,
  onChange,
}: {
  value: Recurrence
  anchorDate: string
  ends: EndMode
  onChange: (next: Recurrence) => void
}) {
  const setEndMode = (next: EndMode) => {
    const { endsAfter: _a, endsOn: _o, ...rest } = value
    if (next === 'after') return onChange({ ...rest, endsAfter: 4 })
    if (next === 'on') {
      const until = new Date(fromDateInput(anchorDate))
      until.setFullYear(until.getFullYear() + 1)
      return onChange({ ...rest, endsOn: until.getTime() })
    }
    onChange(rest)
  }

  return (
    <>
      <Label className="flex flex-col items-start gap-1">
        Ends
        <Select value={ends} onValueChange={(next) => next && setEndMode(next as EndMode)}>
          <SelectTrigger className="w-full">
            <SelectValue>
              {(e: string) => (e === 'after' ? 'After' : e === 'on' ? 'On date' : 'Never')}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="never">Never</SelectItem>
            <SelectItem value="after">After</SelectItem>
            <SelectItem value="on">On date</SelectItem>
          </SelectContent>
        </Select>
      </Label>

      {ends === 'after' ? (
        <Label className="flex flex-col items-start gap-1">
          Times
          <div className="flex w-full items-center gap-2">
            <Input
              type="number"
              min="1"
              max="500"
              value={value.endsAfter ?? 1}
              onChange={(e) =>
                onChange({ ...value, endsAfter: Math.max(1, Number(e.target.value) || 1) })
              }
            />
            <span className="text-xs whitespace-nowrap text-muted-foreground">total</span>
          </div>
        </Label>
      ) : ends === 'on' ? (
        <Label className="flex flex-col items-start gap-1">
          Until
          <Input
            type="date"
            value={toDateInput(value.endsOn ?? fromDateInput(anchorDate))}
            onChange={(e) =>
              e.target.value && onChange({ ...value, endsOn: fromDateInput(e.target.value) })
            }
          />
        </Label>
      ) : (
        <div />
      )}
    </>
  )
}
