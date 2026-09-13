import { useMemo, useState } from 'react'
import { Bot, RotateCcw, Send, Sparkles } from 'lucide-react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import ToolApproval from './ToolApproval'
import { MarkdownContent } from '#/lib/markdown'
import { useBoardChat } from '#/lib/ai-chat'
import type { PendingApproval } from './ToolApproval'
import type { ChatMessages } from '#/lib/ai-chat'
import type { MoneyFormat } from '#/lib/board'

const SUGGESTIONS = [
  'Rent $1200 due on the 15th',
  'Netflix $15 monthly subscription',
  'Getting paid $2400 next Friday',
  'How much do I owe this week?',
]

function ToolLine({ name, summary }: { name: string; summary?: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Sparkles size={12} className="text-primary" />
      <span className="font-medium">{summary ?? name}</span>
    </p>
  )
}

function Messages({
  messages,
  approvals,
  money,
}: {
  messages: ChatMessages
  approvals: Array<PendingApproval>
  money?: MoneyFormat
}) {
  if (!messages.length && approvals.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Bot size={28} className="text-primary" />
        <p className="text-sm font-semibold text-foreground">
          Describe your money in plain English
        </p>
        <p className="text-xs text-muted-foreground">
          I'll create, move and update cards on the board for you.
        </p>
      </div>
    )
  }

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent className="px-4 py-3">
            {messages.map(({ id, role, parts }) => (
              <MessageScrollerItem key={id} messageId={id} scrollAnchor={role === 'user'}>
                <Message align={role === 'user' ? 'end' : 'start'}>
                  <MessageContent>
                    <Bubble variant={role === 'user' ? 'default' : 'muted'}>
                      <BubbleContent>
                        {parts.map((part, index) => {
                          if (part.type === 'text' && part.content) {
                            // Text parts carry no id from the AI SDK. Parts only ever
                            // append while a message streams in - they never reorder
                            // or get filtered - so the index is a stable position.
                            return (
                              // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                              <MarkdownContent key={`${id}-${index}`}>
                                {part.content}
                              </MarkdownContent>
                            )
                          }
                          if (part.type === 'tool-call') {
                            const output = part.output as { summary?: string } | undefined
                            return (
                              <ToolLine key={part.id} name={part.name} summary={output?.summary} />
                            )
                          }
                          return null
                        })}
                      </BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
            {approvals.length > 0 ? (
              <div className="flex flex-col gap-2 px-1 pb-2">
                {approvals.map((approval) => (
                  <ToolApproval key={approval.id} approval={approval} money={money} />
                ))}
              </div>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

export default function AISidebar({
  open,
  onClose,
  money,
}: {
  open: boolean
  onClose: () => void
  money?: MoneyFormat
}) {
  const { messages, sendMessage, status, error, interrupts, resuming, clear } = useBoardChat()
  const [input, setInput] = useState('')

  const busy = status === 'streaming' || status === 'submitted'

  /**
   * Tool calls the server paused for confirmation. Only approval interrupts
   * are actionable here; anything else (an interrupt owned by another system)
   * is left alone rather than answered on its behalf.
   */
  const approvals = useMemo<Array<PendingApproval>>(
    () =>
      interrupts.flatMap((interrupt) => {
        if (interrupt.kind !== 'tool-approval' || !interrupt.canResolve) return []
        return [
          {
            id: interrupt.id,
            toolName: interrupt.toolName,
            args: (interrupt.originalArgs ?? {}) as Record<string, unknown>,
            busy: resuming || interrupt.status === 'submitting',
            approve: () => interrupt.resolveInterrupt(true),
            reject: () => interrupt.resolveInterrupt(false),
          },
        ]
      }),
    [interrupts, resuming],
  )

  const submit = (text: string) => {
    const value = text.trim()
    // A pending approval owns the turn; sending now would race the resume.
    if (!value || busy || approvals.length > 0) return
    // The stream is rendered from `messages`; errors surface through `error`.
    void sendMessage(value)
    setInput('')
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="flex w-full max-w-105 gap-0 p-0 sm:max-w-105">
        <SheetHeader className="flex-row items-center justify-between border-b border-border py-3">
          <SheetTitle className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            Budget assistant
          </SheetTitle>
          {messages.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={busy || approvals.length > 0}
              title="Start a new conversation"
            >
              <RotateCcw size={14} />
              New chat
            </Button>
          ) : null}
        </SheetHeader>

        <Messages messages={messages} approvals={approvals} money={money} />

        {error ? (
          <p className="mx-4 mb-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error.message || 'The assistant is unavailable. Check GEMINI_API_KEY on the server.'}
          </p>
        ) : null}

        {messages.length === 0 ? (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => submit(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(input)
          }}
          className="border-t border-border p-3"
        >
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                approvals.length > 0
                  ? 'Waiting on your approval above…'
                  : busy
                    ? 'Thinking…'
                    : 'Add an expense, ask a question…'
              }
              rows={1}
              className="min-h-10 pr-10 text-sm"
              style={{ maxHeight: '140px' }}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit(input)
                }
              }}
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon-sm"
              disabled={!input.trim() || busy || approvals.length > 0}
              aria-label="Send"
              className="absolute top-1/2 right-2 -translate-y-1/2"
            >
              <Send size={16} />
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
