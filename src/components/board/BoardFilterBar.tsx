import { Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { EMPTY_FILTERS, hasActiveFilters } from '#/lib/board'
import type { BoardFilters, CardPriority, CardType } from '#/lib/board'

const TYPES: Array<{ value: CardType; label: string }> = [
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
]

const PRIORITIES: Array<{ value: CardPriority; label: string }> = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

/**
 * Filters narrow what the columns show without changing what exists. The
 * column counts and totals recompute against the filtered set, so "Groceries"
 * plus a search for "market" answers "how much am I spending there" directly.
 */
export default function BoardFilterBar({
  filters,
  categories,
  onChange,
  matchCount,
  totalCount,
}: {
  filters: BoardFilters
  categories: Array<string>
  onChange: (next: BoardFilters) => void
  matchCount: number
  totalCount: number
}) {
  const active = hasActiveFilters(filters)

  const toggleFrom = <T,>(list: Array<T> | undefined, value: T): Array<T> | undefined => {
    const current = list ?? []
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    return next.length ? next : undefined
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2">
      <div className="relative min-w-[12rem] flex-1">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={filters.search ?? ''}
          onChange={(e) => onChange({ ...filters, search: e.target.value || undefined })}
          placeholder="Search descriptions, payees, notes…"
          className="h-8 pl-8 text-sm"
          aria-label="Search cards"
        />
      </div>

      {TYPES.map((type) => (
        <Toggle
          key={type.value}
          size="sm"
          pressed={filters.types?.includes(type.value) ?? false}
          onPressedChange={() =>
            onChange({ ...filters, types: toggleFrom(filters.types, type.value) })
          }
        >
          {type.label}
        </Toggle>
      ))}

      <Select
        value={filters.categories?.[0] ?? '__all__'}
        onValueChange={(value) =>
          onChange({
            ...filters,
            categories: !value || value === '__all__' ? undefined : [value],
          })
        }
      >
        <SelectTrigger size="sm" className="w-[10rem]">
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All categories</SelectItem>
          {categories.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.priorities?.[0] ?? '__all__'}
        onValueChange={(value) =>
          onChange({
            ...filters,
            priorities: !value || value === '__all__' ? undefined : [value as CardPriority],
          })
        }
      >
        <SelectTrigger size="sm" className="w-[8rem]">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Any priority</SelectItem>
          {PRIORITIES.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Toggle
        size="sm"
        pressed={filters.recurringOnly ?? false}
        onPressedChange={(pressed) => onChange({ ...filters, recurringOnly: pressed || undefined })}
      >
        Recurring
      </Toggle>

      {active ? (
        <>
          <Badge variant="secondary" className="tabular-nums">
            {matchCount} of {totalCount}
          </Badge>
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            <X size={14} />
            Clear
          </Button>
        </>
      ) : null}
    </div>
  )
}
