import { Store } from '@tanstack/store'

export interface ToastAction {
  label: string
  run: () => void | Promise<unknown>
}

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  /** Optional single action, used for undo. */
  action?: ToastAction
  /** While an action is running, so the button can't be fired twice. */
  pending?: boolean
}

export const toasts = new Store<Array<Toast>>([])

let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

export function dismissToast(id: number) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.setState((list) => list.filter((t) => t.id !== id))
}

/**
 * A toast with an action sticks around longer: an undo the user never gets to
 * click is the same as no undo at all.
 */
function lifespan(toast: Pick<Toast, 'tone' | 'action'>) {
  if (toast.tone === 'error') return 6000
  return toast.action ? 8000 : 3000
}

export function pushToast(
  message: string,
  tone: Toast['tone'] = 'info',
  action?: ToastAction,
): number {
  const id = nextId++
  toasts.setState((list) => [...list, { id, message, tone, action }])
  timers.set(
    id,
    setTimeout(() => dismissToast(id), lifespan({ tone, action })),
  )
  return id
}

/** Fire a toast's action, then close it. */
export async function runToastAction(id: number) {
  const toast = toasts.state.find((t) => t.id === id)
  if (!toast?.action || toast.pending) return

  toasts.setState((list) => list.map((t) => (t.id === id ? { ...t, pending: true } : t)))
  try {
    await toast.action.run()
    dismissToast(id)
  } catch (cause) {
    console.error('Toast action failed', cause)
    dismissToast(id)
    pushToast('That could not be undone', 'error')
  }
}

/**
 * Runs a mutation and surfaces failures instead of leaving the UI silently
 * out of date. Convex retries transient errors itself, so anything that lands
 * here is worth telling the user about.
 */
export async function withToast<T>(
  promise: Promise<T>,
  { error }: { error: string },
): Promise<T | undefined> {
  try {
    return await promise
  } catch (cause) {
    console.error(error, cause)
    pushToast(error, 'error')
    return undefined
  }
}

/**
 * Run a mutation, and on success offer a one-click reversal.
 *
 * The undo is expressed as the inverse mutation rather than as a client-side
 * state rollback, so it survives the page being closed and reopened mid-toast
 * and it stays correct when another device changed the board in between.
 */
export async function withUndo<T>(
  promise: Promise<T>,
  options: {
    error: string
    message: string | ((result: T) => string)
    undo: (result: T) => void | Promise<unknown>
    undoLabel?: string
  },
): Promise<T | undefined> {
  try {
    const result = await promise
    const message =
      typeof options.message === 'function' ? options.message(result) : options.message
    pushToast(message, 'info', {
      label: options.undoLabel ?? 'Undo',
      run: () => options.undo(result),
    })
    return result
  } catch (cause) {
    console.error(options.error, cause)
    pushToast(options.error, 'error')
    return undefined
  }
}
