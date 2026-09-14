import { Link } from '@tanstack/react-router'
import { Bot, LayoutGrid, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

const FEATURES = [
  {
    icon: <Bot size={20} />,
    title: 'Talk, don’t type forms',
    body: '“Rent $1200 due on the 15th” becomes a card, categorised and dated.',
  },
  {
    icon: <LayoutGrid size={20} />,
    title: 'Plan it, pay it, wish for it',
    body: 'Expenses move upcoming → due → paid, income expected → received, and a wishlist shows when you could afford the rest.',
  },
  {
    icon: <Zap size={20} />,
    title: 'Live everywhere',
    body: 'Convex keeps every open tab in sync the instant a card changes.',
  },
]

export default function SignedOutHero() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12">
      <Card className="relative overflow-hidden px-6 py-12 sm:px-10">
        <CardContent className="px-0">
          <p className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Budget Board
          </p>
          <h1 className="mb-4 max-w-3xl text-4xl leading-[1.05] font-bold tracking-tight text-foreground sm:text-6xl">
            A kanban board for the money coming and going.
          </h1>
          <p className="mb-8 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Describe a bill or a paycheck in plain English and the assistant puts it on the board.
            Drag a card to mark it paid.
          </p>
          <Button size="lg" className="px-5" render={<Link to="/signin" />}>
            Sign in to get started
          </Button>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <Card key={feature.title}>
            <CardContent>
              <span className="text-primary">{feature.icon}</span>
              <h2 className="mt-3 text-base font-semibold text-foreground">{feature.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{feature.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  )
}
