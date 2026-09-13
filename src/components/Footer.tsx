export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-16 border-t border-border px-4 pt-8 pb-10 text-muted-foreground 2xl:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-center sm:flex-row sm:text-left xl:max-w-[1400px] 2xl:max-w-none">
        <p className="m-0 text-sm">&copy; {year} Budget Board</p>
        <p className="m-0 text-xs font-semibold tracking-wide uppercase">
          Built with TanStack Start, Convex and TanStack AI
        </p>
      </div>
    </footer>
  )
}
