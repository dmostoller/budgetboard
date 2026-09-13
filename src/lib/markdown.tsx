import { Markdown } from '@tanstack/markdown/react'
import { defaultHighlighter } from '@tanstack/highlight'
import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown'
import { cn } from '@/lib/utils'

const highlighter = createTanStackMarkdownHighlighter(defaultHighlighter)

export function MarkdownContent({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <Markdown highlighter={highlighter}>{children}</Markdown>
    </div>
  )
}
