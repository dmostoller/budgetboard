import { useStore } from '@tanstack/react-store'
import { AlertCircle, Check, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { dismissToast, runToastAction, toasts } from '#/lib/toast'

export default function Toaster() {
  const list = useStore(toasts, (state) => state)

  if (list.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-200 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2">
      {list.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl',
            toast.tone === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-border bg-popover text-popover-foreground',
          )}
        >
          {toast.tone === 'error' ? (
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Check size={16} className="mt-0.5 shrink-0" />
          )}
          <p className="flex-1">{toast.message}</p>

          {toast.action ? (
            <button
              type="button"
              onClick={() => void runToastAction(toast.id)}
              disabled={toast.pending}
              className="mt-px inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-50"
            >
              <Undo2 size={12} />
              {toast.pending ? 'Undoing…' : toast.action.label}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
            className="mt-0.5 shrink-0 opacity-70 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
