import { Link } from '@tanstack/react-router'
import BetterAuthHeader from '../integrations/better-auth/header-user'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 px-4 backdrop-blur-lg 2xl:px-8">
      <nav className="mx-auto flex max-w-6xl items-center gap-3 py-3 xl:max-w-350 2xl:max-w-none">
        <Link
          to="/"
          className="group flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <img
            src="/logo.png"
            alt=""
            className="h-6 w-6 opacity-80 transition-opacity group-hover:opacity-100"
          />
          <span className="text-lg font-semibold tracking-tight text-foreground">Budget Board</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <BetterAuthHeader />
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
