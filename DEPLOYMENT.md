# Deployment runbook

Zero to a live Budget Board on Vercel, with Convex for the board data, Neon for
auth storage, Google OAuth for sign-in and Gemini for the assistant.

Work top to bottom the first time — later steps need values the earlier ones
produce. Rough timing: 30–45 minutes, most of it waiting on dashboards.

**Accounts you'll need:** [Vercel](https://vercel.com),
[Convex](https://convex.dev), [Neon](https://neon.tech),
[Google Cloud](https://console.cloud.google.com),
[Google AI Studio](https://aistudio.google.com). All have free tiers that cover
a personal board.

---

## 0. Get the code onto `main`

The app lives on the `claude/budget-board-tanstack-i2gmei` branch. Either:

```bash
# via a pull request (keeps a review trail)
gh pr create --base main --head claude/budget-board-tanstack-i2gmei
gh pr merge --squash
```

or straight from the terminal:

```bash
git checkout main
git merge claude/budget-board-tanstack-i2gmei
git push origin main
```

Vercel builds whatever branch you point it at, so you can also skip this and
deploy the branch first — but production deploys track `main` by default.

---

## 1. Local setup

```bash
pnpm install
cp .env.example .env.local
```

The repo uses [Vite+](https://viteplus.dev) and pnpm — `packageManager` in
`package.json` pins the pnpm version, so `corepack enable` is enough to get the
right one. Every command below runs through pnpm; nothing needs a global
install.

Leave `.env.local` open; the next steps fill it in.

---

## 2. Convex — the board data

Convex holds cards, categories and per-user settings, and pushes live updates to
every open tab.

```bash
pnpm exec convex dev
```

The first run walks you through logging in and creating a project. Name it
something like `budget-board`. It writes `CONVEX_DEPLOYMENT` and
`VITE_CONVEX_URL` into `.env.local` itself, pushes `convex/schema.ts`, and then
watches for changes.

Leave it running while you develop. Two deployments exist per project:

| Deployment | Created by      | Used by         |
| ---------- | --------------- | --------------- |
| dev        | `convex dev`    | your machine    |
| prod       | `convex deploy` | Vercel (step 7) |

Verify: the Convex dashboard (`pnpm exec convex dashboard`) shows `cards`,
`categories` and `settings` tables, empty.

---

## 3. Neon — auth storage

Convex stores the board; Better Auth needs its own SQL database for users,
sessions and OAuth accounts.

1. Create a Neon project (any region near you; the free tier is fine).
2. From the project dashboard, copy the **pooled** connection string — it looks
   like `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`.
   The pooled host (with `-pooler`) is the one to use: serverless functions open
   many short-lived connections.
3. Put it in `.env.local`:

   ```bash
   DATABASE_URL=postgresql://…-pooler…/neondb?sslmode=require
   ```

4. Create the auth tables:

   ```bash
   pnpm dlx @better-auth/cli migrate
   ```

   It prints the schema it is about to create (`user`, `session`, `account`,
   `verification`, `jwks`) and asks for confirmation.

   `jwks` holds the RS256 keypair Better Auth signs Convex tokens with. Skip
   this table and sign-in appears to work while `/api/auth/token` returns a
   500, leaving the board permanently empty — so it is not optional.

Verify: in Neon's SQL editor, `select * from "user";` returns zero rows rather
than an error, and `select * from "jwks";` does the same.

> Without `DATABASE_URL` the app falls back to an in-memory store and warns on
> boot. That is fine for a first local run, but the server **refuses to start in
> production** without it, rather than quietly losing every account on each cold
> start.

---

## 3b. Tell Convex which tokens to trust

Convex does not share this app's session cookie. It verifies a JWT, and it
discovers the signing keys by fetching
`${SITE_URL}/.well-known/openid-configuration` — a small document this app
serves from `src/routes/[.]well-known/openid-configuration.ts`, pointing at
Better Auth's JWKS.

`SITE_URL` is the token's `iss` claim, so it must match `BETTER_AUTH_URL`
character for character on every deployment:

```bash
# dev
npx convex env set SITE_URL http://localhost:3000

# production
npx convex env set --prod SITE_URL https://your-app.vercel.app
```

Optionally, so the weekly briefing phrases its findings with the model instead
of the built-in templates:

```bash
npx convex env set GEMINI_API_KEY <key>
```

Verify: `curl $BETTER_AUTH_URL/.well-known/openid-configuration` returns JSON
whose `issuer` equals `SITE_URL`, and `curl $BETTER_AUTH_URL/api/auth/jwks`
returns a key with `"alg": "RS256"`.

A mismatch here is the single most likely cause of a signed-in user seeing an
empty board: Better Auth issues the token happily, and Convex rejects it
because the issuer does not match anything it trusts.

### Local development needs the keys inlined

Discovery only works when Convex can reach the app. In production it can. On a
laptop it cannot — a cloud deployment resolving `http://localhost:3000` gets
its own container, so it never retrieves the signing keys, treats every request
as anonymous, and the board sits empty while writes fail with `Not signed in`.

So for the **dev** deployment, give Convex the key set rather than a URL to go
and get it from. With the app running:

```bash
npx convex env set JWKS "$(./scripts/jwks-data-uri.sh)"
```

`convex/auth.config.ts` switches to Convex's `customJwt` provider whenever
`JWKS` is set, where `issuer` and `jwks` are separate fields — the token still
claims `iss: http://localhost:3000` while the keys come from the config itself.

Leave `JWKS` **unset on production**, so it keeps using discovery against the
real domain. The embedded value is a public key set, not a secret, but it does
go stale if Better Auth rotates its signing key (off by default); `./dev.sh`
compares Convex's copy against the app's live one at startup and says so.

---

## 4. Better Auth secret

```bash
pnpm dlx @better-auth/cli secret
```

Paste the result into `.env.local`:

```bash
BETTER_AUTH_SECRET=<the generated value>
BETTER_AUTH_URL=http://localhost:3000
```

Generate a **different** secret for production in step 7 — rotating it later
invalidates every session, so treat it like a password.

---

## 5. Gemini — the assistant

1. Create an API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Add it to `.env.local`:

   ```bash
   GEMINI_API_KEY=<key>
   GEMINI_MODEL=gemini-2.5-flash
   ```

The key is server-side only — it is read in `src/routes/api.ai.chat.ts` and
never reaches the browser. Without it the app runs fine and the sidebar reports
that the assistant is unconfigured.

---

## 6. Google OAuth (optional)

Email/password sign-in works without this. To add the "Continue with Google"
button:

1. Google Cloud Console → **APIs & Services → OAuth consent screen**. External,
   fill in the app name and your email, add yourself as a test user.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorised redirect URIs — add both, exactly:

   ```
   http://localhost:3000/api/auth/callback/google
   https://<your-domain>/api/auth/callback/google
   ```

   You will not know the production domain until step 7; come back and add it.
   Vercel preview URLs change per deployment, so either add the ones you care
   about or test Google sign-in on production only.

4. Copy the client id and secret into `.env.local`:

   ```bash
   GOOGLE_CLIENT_ID=<id>
   GOOGLE_CLIENT_SECRET=<secret>
   ```

The button only renders when both values are present, so a half-configured
setup never shows a broken button.

### Check the whole thing locally

```bash
pnpm dev     # in a second terminal, with `convex dev` still running
```

Sign up, add a card, drag it to **Paid**, then ask the assistant
"rent $1200 due on the 15th" and watch it appear on the board.

---

## 7. Vercel

The repo is already configured for Vercel: `vite.config.ts` uses the Nitro
plugin, and Nitro switches to its Vercel preset automatically when Vercel sets
`VERCEL=1` during the build. There is no `vercel.json` to write.

### 7a. Create the project

Vercel dashboard → **Add New → Project** → import the GitHub repo. Framework
preset: **Vite** (or "Other" — the build command is what matters).

### 7b. Build settings

| Setting          | Value                                            |
| ---------------- | ------------------------------------------------ |
| Build command    | `pnpm exec convex deploy --cmd 'pnpm run build'` |
| Output directory | leave empty                                      |
| Install command  | leave empty (Vercel detects pnpm)                |
| Node version     | 22.x                                             |

`convex deploy --cmd` pushes `convex/` to your **production** Convex
deployment, sets `VITE_CONVEX_URL` to the production URL, and only then runs the
app build — so the deployed bundle always points at the deployment whose schema
it was built against.

### 7c. Environment variables

**Settings → Environment Variables.** Add for Production (and Preview, if you
want previews to work):

| Name                   | Value                                                     |
| ---------------------- | --------------------------------------------------------- |
| `CONVEX_DEPLOY_KEY`    | Convex dashboard → Settings → **Production** → Deploy key |
| `DATABASE_URL`         | the Neon pooled connection string                         |
| `BETTER_AUTH_SECRET`   | a **fresh** secret, not the local one                     |
| `BETTER_AUTH_URL`      | `https://<your-domain>` (set after the first deploy)      |
| `GEMINI_API_KEY`       | your Gemini key                                           |
| `GEMINI_MODEL`         | `gemini-2.5-flash`                                        |
| `GOOGLE_CLIENT_ID`     | if using Google sign-in                                   |
| `GOOGLE_CLIENT_SECRET` | if using Google sign-in                                   |

Do **not** set `VITE_CONVEX_URL` by hand — `convex deploy --cmd` injects it. And
never prefix a secret with `VITE_`: anything so named is inlined into the
browser bundle.

### 7d. Deploy

Push to `main`, or hit **Deploy**. First build takes a couple of minutes.

Then, because two values depend on the domain Vercel just handed you:

1. Set `BETTER_AUTH_URL` to the real origin and redeploy (auth callbacks and
   cookies are built from it — sign-in silently misbehaves if it is wrong).
2. Add `https://<domain>/api/auth/callback/google` to the Google OAuth client.

### 7e. Verify production

- `https://<domain>/` renders the landing page.
- Sign up with email/password → you land on an empty board.
- `select email from "user";` in Neon shows the account.
- Add a card; the Convex production dashboard shows the row.
- Ask the assistant something; the card appears without a refresh.

---

## Day-to-day

| Task                      | Command                                                |
| ------------------------- | ------------------------------------------------------ |
| Develop                   | `pnpm exec convex dev` + `pnpm dev`                    |
| Change the Convex schema  | save the file — `convex dev` pushes it                 |
| Ship                      | push to `main`; Vercel builds and `convex deploy` runs |
| Run the checks CI runs    | `pnpm check && pnpm test`                              |
| Build exactly like Vercel | `VERCEL=1 pnpm build` → `.vercel/output`               |
| Preview the server build  | `pnpm build && node .output/server/index.mjs`          |
| Convex production console | `pnpm exec convex dashboard --prod`                    |

Schema changes reach production only through `convex deploy`, which the Vercel
build command runs for you. Adding a required field to a table with existing
rows will be rejected — add it as `v.optional(...)`, backfill, then tighten.

---

## Troubleshooting

**Build fails: `Missing VITE_CONVEX_URL`** — the build command is missing the
`convex deploy --cmd` wrapper, or `CONVEX_DEPLOY_KEY` is unset in Vercel.

**Runtime: `DATABASE_URL is required in production`** — the variable is missing
from the Production environment (setting it only for Preview is a common slip).
Add it and redeploy; Vercel does not apply env changes to an existing build.

**Sign-in redirects to the wrong host, or the session drops immediately** —
`BETTER_AUTH_URL` does not match the origin you are browsing. It must be the
exact scheme + host, no trailing slash.

**Google sign-in: `redirect_uri_mismatch`** — the callback URL in Google Cloud
must match character for character, including `https` and the
`/api/auth/callback/google` path.

**Assistant replies "GEMINI_API_KEY is not configured"** — the key is missing in
that environment, or was added after the deployment that is currently serving.

**Neon: `too many connections`** — you are on the direct connection string.
Switch to the `-pooler` host.

**Cards do not appear for the assistant, or vice versa** — the browser and the
server are on different Convex deployments. Both must use the same
`VITE_CONVEX_URL`; check the value baked into the deployment's build logs.

**`ERR_MODULE_NOT_FOUND: @better-auth/utils/...`** — Nitro's dependency tracing
does not follow Better Auth's subpath exports. `vite.config.ts` already inlines
those packages (`externals.inline`); if you rework that config, keep it.

---

## What runs where

```
Browser ──── live queries ────► Convex (cards, categories, settings)
   │                               ▲
   │ session cookie                │ mutations from the AI tools
   ▼                               │
Vercel Function (TanStack Start SSR + /api routes)
   ├── Better Auth ──► Neon Postgres (users, sessions, accounts)
   └── /api/ai/chat ──► Gemini
```

The assistant's tools run on the server with the verified session id and write
to Convex directly, which is why a card it creates shows up on the board without
a refresh.
