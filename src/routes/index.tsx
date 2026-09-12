import { createFileRoute } from '@tanstack/react-router'
import Board from '#/components/board/Board'
import SignedOutHero from '#/components/SignedOutHero'
import { useUserId } from '#/lib/user'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { userId, isPending } = useUserId()

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    )
  }

  if (!userId) {
    return <SignedOutHero />
  }

  return (
    <main>
      <Board />
    </main>
  )
}
