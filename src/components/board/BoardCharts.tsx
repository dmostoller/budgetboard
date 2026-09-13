import type { ReactNode } from 'react'

/** Below `2xl`, charts stack as full-width bands above the columns. */
export function BoardChartBands({
  cashFlowEl,
  categoryEl,
  outflowEl,
  budgetEl,
  hasBudgets,
}: {
  cashFlowEl: ReactNode
  categoryEl: ReactNode
  outflowEl: ReactNode
  budgetEl: ReactNode
  hasBudgets: boolean
}) {
  return (
    <>
      <div className="mb-6 grid gap-4 lg:grid-cols-2 2xl:hidden">
        {cashFlowEl}
        {hasBudgets ? budgetEl : categoryEl}
      </div>

      <div className={`mb-6 grid gap-4 2xl:hidden ${hasBudgets ? 'lg:grid-cols-2' : ''}`}>
        {outflowEl}
        {hasBudgets ? categoryEl : null}
      </div>
    </>
  )
}

/** At `2xl`, the same charts move into a sticky rail beside the columns. */
export function BoardChartRail({
  cashFlowEl,
  categoryEl,
  outflowEl,
  budgetEl,
}: {
  cashFlowEl: ReactNode
  categoryEl: ReactNode
  outflowEl: ReactNode
  budgetEl: ReactNode
}) {
  return (
    <aside className="hidden 2xl:sticky 2xl:top-6 2xl:block 2xl:w-142.5 2xl:shrink-0">
      <div className="flex flex-col gap-4">
        {cashFlowEl}
        {outflowEl}
        {budgetEl}
        {categoryEl}
      </div>
    </aside>
  )
}
