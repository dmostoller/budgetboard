# Budget Board

A Trello-style board for personal cash flow. Describe money in plain English —
"Rent $1200 due on the 15th", "getting paid $2400 next Friday" — and the AI
assistant puts it on the board as a card. Drag cards between columns to track
what is paid and what has landed.

Built to the spec in [PLAN.md](./PLAN.md).

## Stack

| Layer       | Choice                                               |
| ----------- | ---------------------------------------------------- |
| Framework   | TanStack Start (Vite, file-based routing)            |
| Data        | Convex (schema, queries, mutations, live updates)    |
| AI          | TanStack AI + `@tanstack/ai-gemini`                  |
| Auth        | Better Auth (email/password + optional Google OAuth) |
| Forms       | TanStack Form + Zod v4                               |
| State       | TanStack Store (toasts)                              |
| Drag & drop | dnd-kit (pointer, touch and keyboard)                |
| Styling     | Tailwind CSS v4, light/dark themed with CSS vars     |
| Tooling     | Vite+ (`vp`): Vite, Vitest, Oxlint, Oxfmt, pnpm      |
| Deploy      | Vercel (Nitro), Convex prod, Neon Postgres           |

## What the app does

- **Two swimlanes.** Expenses run `upcoming → due → paid`; income runs
  `expected → received`. A card can only move between its own lane's columns.
- **Drag and drop** with fractional ordering, so dropping between two cards is
  a single patch and every other tab sees it immediately.
- **Info bar** with expected income, upcoming expenses, net balance, overdue
  and due-this-week counts, all scoped to the rolling horizon.
- **Reminders** in the header bell: overdue bills, due today, due this week,
  and income that never arrived. Alerts are derived from the cards themselves,
  so they can't go stale; dismissing one hides that exact state, and it speaks
  up again if the date slips.
- **Card editor** (click any card) with validation, inline creation of custom
  categories, and a column picker.
- **Recurring cards** carry a badge and a one-click "copy forward" that clones
  the card into the next month.
- **Settings** page for the time horizon, showing/hiding completed cards, and
  managing custom categories.
- **AI assistant** in the right sidebar for creating, editing, moving and
  querying cards.
- Light/dark/system theme, responsive down to a phone, and toasts whenever a
  write fails instead of a silently stale board.

## Getting started

```bash
pnpm install
pnpm exec convex dev   # creates a deployment, fills CONVEX_DEPLOYMENT / VITE_CONVEX_URL
pnpm dev               # http://localhost:3000
```

Copy `.env.example` to `.env.local` and fill in:

| Variable                  | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `CONVEX_DEPLOYMENT`       | Written by `convex dev`                             |
| `VITE_CONVEX_URL`         | Convex deployment URL (browser **and** AI tools)    |
| `BETTER_AUTH_URL`         | App origin, e.g. `http://localhost:3000`            |
| `BETTER_AUTH_SECRET`      | `pnpm dlx @better-auth/cli secret`                  |
| `DATABASE_URL`            | Postgres for Better Auth — required in production   |
| `GOOGLE_CLIENT_ID/SECRET` | Optional; enables the "Continue with Google" button |
| `GEMINI_API_KEY`          | Required for the AI assistant                       |
| `GEMINI_MODEL`            | Defaults to `gemini-2.5-flash`                      |

`convex dev` must stay running (or be run once with `--once`) for schema
changes in `convex/` to reach the deployment; it also regenerates
`convex/_generated/`.

### Auth storage

Convex holds the board; Better Auth needs its own store for users, sessions and
OAuth accounts. Point `DATABASE_URL` at any Postgres (Neon, Supabase, RDS…) and
run the migration once:

```bash
pnpm dlx @better-auth/cli migrate
```

This also creates the `jwks` table holding the RS256 keypair that signs Convex
tokens. Sign-in works without it, but `/api/auth/token` returns a 500 and the
board stays empty, so run it before anything else.

Without `DATABASE_URL` the app falls back to Better Auth's in-memory store and
warns on boot — fine for a first local run, but accounts vanish on restart. In
production the server refuses to start without it rather than quietly losing
accounts.

### Telling Convex which tokens to trust

Convex validates the JWT rather than sharing the session cookie, so it needs
two things: the issuer to expect, and the public keys to check the signature
against.

`SITE_URL` is the issuer. It must match `BETTER_AUTH_URL` exactly — it is the
token's `iss` claim:

```bash
npx convex env set SITE_URL http://localhost:3000
```

The keys are the part that differs between local and deployed, because Convex
fetches them over the public internet and **cannot reach `localhost`**. A cloud
deployment resolving `localhost` gets its own container, so key discovery
quietly yields nothing and every request looks anonymous — reads come back
empty and writes fail with `Not signed in`.

Locally, hand Convex the key set directly instead. With the app running:

```bash
npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"
```

That stores the JWKS as a `data:` URI, which `convex/auth.config.ts` passes to
Convex's `customJwt` provider. `issuer` and `jwks` are independent there, so
the token can keep claiming `iss: http://localhost:3000` while the keys come
from somewhere Convex can actually read. Nothing is fetched at all.

In production, leave `JWKS` unset: the deployed origin _is_ reachable, and the
config falls back to ordinary OIDC discovery.

The embedded value is a **public** key set, so it is configuration rather than
a secret. Regenerate it if Better Auth ever rotates its signing key (rotation
is off by default) — `./dev.sh` compares the two on startup and warns when they
drift, because the symptom otherwise is an abrupt, total `Not signed in`.

Optionally, so the weekly briefing phrases its findings with the model rather
than the built-in templates:

```bash
npx convex env set GEMINI_API_KEY <key>
```

### One-time data migrations

Existing boards need three idempotent backfills, safe to re-run:

```bash
npx convex run migrations:toCents
npx convex run migrations:normalizeRules
npx convex run migrations:adoptSeriesIds
```

`toCents` moves float dollars into the integer `amountCents` column (the float
`amount` is left in place rather than deleted, so a bad conversion can be
inspected). `normalizeRules` pins every recurrence rule to an explicit day.
`adoptSeriesIds` gives pre-existing recurring cards a series identity so the
nightly autoroll can find them.

## Scripts

This project uses [Vite+](https://viteplus.dev) and pnpm. `vp` comes from the
`vite-plus` dependency, so `pnpm run <script>` works without installing anything
globally; if you have the global `vp` CLI, `vp check` and friends work directly.

| Script                | Does                                       |
| --------------------- | ------------------------------------------ |
| `pnpm dev`            | Dev server on port 3000                    |
| `pnpm build`          | Production build (Vite + Rolldown + Nitro) |
| `pnpm test`           | Vitest (Convex functions + client logic)   |
| `pnpm test:watch`     | Vitest in watch mode                       |
| `pnpm check`          | Oxfmt + Oxlint + type checks, in one pass  |
| `pnpm check --fix`    | …and fix what can be fixed                 |
| `pnpm run format`     | Oxfmt only                                 |
| `pnpm run lint`       | Oxlint only                                |
| `pnpm run typecheck`  | `tsc --noEmit` (the full compiler)         |
| `pnpm run convex:dev` | Convex dev/codegen watcher                 |

CI (`.github/workflows/ci.yml`) runs `pnpm check`, the tests and the build on
every push and pull request.

## Tests

`convex-test` runs the Convex functions in-memory, so the data layer is covered
without a deployment: column rules, `completedAt` stamping, fractional
reordering, per-user isolation, the stats maths, categories and settings.
Client-side coverage is the pure logic — date handling, urgency, reminder
derivation, the assistant's card filter and the toast queue.

```bash
pnpm test
```

## How the AI writes to the board

`src/lib/ai-tools.ts` builds the tool set **per request**, closing over the
signed-in user's id so the model can never address another user's cards. The
tools (`createCard`, `updateCard`, `moveCard`, `deleteCard`, `listCards`,
`queryBalance`, `suggestCategory`) run server-side against Convex through
`ConvexHttpClient`, so a write made by the assistant streams straight back into
the board's live queries — no refetch, no optimistic patching.

The system prompt pins today's date so "the 15th" and "next Friday" resolve
correctly, and the chat transcript is persisted to `localStorage` by the
TanStack AI client (`src/lib/ai-chat.ts`), so a reload or a dropped connection
keeps the thread.

## Layout

```
convex/
  schema.ts        cards, categories, settings
  cards.ts         list / get / create / update / move / remove / repeat / stats
  categories.ts    default + custom categories
  settings.ts      horizon and show-completed, per user
  *.test.ts        convex-test coverage of the above
src/
  lib/board.ts          shared lane/column/format vocabulary
  lib/notifications.ts  reminder derivation and dismissal
  lib/ai-tools.ts       server-side AI tools over Convex
  lib/ai-chat.ts        client chat hook (SSE + persistence)
  lib/toast.ts          toast store + mutation error wrapper
  components/board/     Board, Column, BoardCard, CardDialog, StatsBar,
                        AISidebar, NotificationsBell
  routes/               / (board), /signin, /settings, /api/ai/chat, /api/auth/$
```

## Deploying

[DEPLOYMENT.md](./DEPLOYMENT.md) is the full runbook: Convex, Neon, Google
OAuth, Gemini keys and the Vercel project, in the order they need to happen.

The short version, once the accounts exist:

- Vercel build command: `pnpm exec convex deploy --cmd 'pnpm run build'`
- Environment: `CONVEX_DEPLOY_KEY`, `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `GEMINI_API_KEY` (plus the Google pair, if used)

`vite.config.ts` uses the Nitro plugin, which picks the Vercel preset from
`VERCEL=1` at build time and a plain Node server otherwise — so
`pnpm build && node .output/server/index.mjs` previews the real production
server locally.

## Known deviations from the plan

- **Netlify → Vercel** — the TanStack CLI has no Vercel option, so the scaffold
  shipped the Netlify plugin. It has been swapped for the Nitro plugin, which
  covers Vercel and plain Node from one config.
- **ESLint and Prettier are gone.** The project runs on Vite+, so linting is
  Oxlint and formatting is Oxfmt, both configured in `vite.config.ts` and run by
  `pnpm check`. Type-aware lint rules and type checking come through the same
  command.
- **shadcn/ui** — the UI is built on the scaffold's own themed CSS layer
  (`src/styles.css`, the `ui-*` classes) rather than shadcn components. Both
  give the same light/dark behaviour; this avoided re-skinning a finished UI.
- **Durable streams** — the assistant uses SSE plus client-side transcript
  persistence rather than TanStack AI's run-store resume. Same practical
  resilience across reloads and dropped connections, without depending on
  server-side run storage.
- **Convex verifies the session itself.** Functions take no `userId` argument;
  each one derives the caller from `ctx.auth.getUserIdentity()`. The Better
  Auth `jwt` plugin mints a short-lived RS256 token, this app serves the OIDC
  discovery document at `/.well-known/openid-configuration`, and
  `convex/auth.config.ts` points Convex at it. The AI tools take the same route
  — the chat route mints the same token and hands it to `ConvexHttpClient`, so
  there is no server-side path that trusts an id instead of a signature.

## Not in V1

Email/push notifications, CSV import/export, bank sync and shared boards — see
the end of [PLAN.md](./PLAN.md).
