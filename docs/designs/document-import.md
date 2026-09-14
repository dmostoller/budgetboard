# Design: Import Cards from Documents

**Status:** Draft · **Date:** 2026-09-13 · **Author:** dmostoller

## 1. Summary

Let a user drop in a spreadsheet, bank/credit-card statement, or receipt and
turn its contents into board cards. The file is extracted, an LLM maps the
content onto the card schema, the user reviews and edits the proposed cards,
and a single mutation commits them.

## 2. Goals / Non-goals

**Goals**

- Import `.xlsx`, `.xls`, `.csv` spreadsheets (e.g. `Monthly_Finance_Tracker.xlsx`).
- Import PDF bank and credit-card statements.
- Import receipts as images (`.jpg`, `.png`, `.heic`) or PDFs.
- Always show a review step before anything is written.
- Detect likely duplicates against existing cards.
- Make an import undoable as a batch.

**Non-goals (v1)**

- Direct bank connections (Plaid etc.).
- Native parsing of Apple `.pages` / `.numbers` files (see §6.4).
- Importing budgets and categories automatically (proposed only, see §9).
- Background/email-in import.

## 3. Example input: `Monthly_Finance_Tracker.xlsx`

| Sheet | Content | Maps to |
| --- | --- | --- |
| Dashboard | Formulas / summary | Skip |
| Lists (hidden) | Categories, types | Category suggestions |
| Transactions | Date, Name, Type, Category, Amount, Notes | One-off cards |
| Recurring | Name, Type, Category, Amount, Frequency (months), Start date, # of payments | Recurring cards (`recurrence.frequency: 'monthly'`, `interval`, `endsAfter`) |
| Budgets | Category, Budget | `budgets` (optional, §9) |
| Monthly Summary | Formulas | Skip |

Observations that drive the design:

- Real sheets contain template junk ("Supermarket (example row - delete/replace)").
- Headers are not on row 1 (title rows, section labels like `INCOME SETTINGS`).
- Values may be formulas; we need cached values, not formula text.
- Category names mostly overlap with `DEFAULT_EXPENSE_CATEGORIES` but not exactly
  (`Gas/Transport`, `Debt Payments`).

A hard-coded column mapper would handle this file and nothing else, which is why
mapping is delegated to the model (§5).

## 4. User flow

1. **Import** button in `BoardToolbar` → `ImportDialog` opens.
2. User drops a file (or several). Client shows file type and size.
3. **Extracting…** — client-side extraction (spreadsheets) or upload (PDF/image).
4. **Analyzing…** — server calls the model, returns proposed cards.
5. **Review table** (editable):
   - checkbox per row (default on; off for flagged duplicates / low confidence)
   - type, description, amount, date, category, status, recurrence summary
   - badges: `duplicate?`, `new category`, `low confidence`, source sheet/page
   - bulk actions: set category, set status, select/deselect all
6. **Import N cards** → commit mutation → toast with **Undo**.

## 5. Architecture

```
Browser                              TanStack Start server            Convex
───────                              ─────────────────────            ──────
ImportDialog
 ├─ xlsx/csv ─ SheetJS → rows JSON ─┐
 └─ pdf/img ─ base64 (≤ 15 MB) ─────┼─▶ POST /api/import/extract
                                    │    auth + Gemini structured ──▶ categories.list
                                    │    output → ProposedCard[]      cards (dup check)
                                    ◀────────────────────────────────
 Review table (local state)
 └─ confirm ────────────────────────────────────────────────────────▶ imports.commit
                                                                     imports.undo
```

### 5.1 Why a server route, not a Convex action

The AI chat already runs in `src/routes/api.ai.chat.ts` using `@tanstack/ai` +
`@tanstack/ai-gemini`, authenticates via `auth.api.getSession`, and talks to
Convex with the user's minted JWT. The extract endpoint reuses that exact
pattern and the `GEMINI_API_KEY` / `GEMINI_MODEL` config, so there is one place
secrets and model choice live.

### 5.2 Extraction (client)

| Input | Library | Output sent to server |
| --- | --- | --- |
| xlsx / xls / csv | `xlsx` (SheetJS, lazy-loaded) | `{ sheet, rows: (string\|number\|null)[][] }[]`, hidden sheets flagged, empty rows dropped, dates converted to ISO, cached formula values only |
| PDF | none | raw file (base64) — Gemini reads PDFs natively, including scanned ones |
| image | none | raw file (base64); HEIC converted client-side or rejected with a hint |

Spreadsheets are extracted client-side to keep payloads small and avoid sending
styles/formulas. Limits: 5,000 rows total, 15 MB per file; larger inputs get an
error asking the user to split or export a date range.

### 5.3 Mapping (server, `/api/import/extract`)

- Load the user's categories (`categories.list`) and pass them into the prompt.
- Prompt describes the card schema, status rules, and document types
  (spreadsheet ledger, statement, receipt) and asks the model to classify first.
- Use structured output (JSON schema) — no free-text parsing.
- Chunk large spreadsheets (~300 rows per call) and run calls in parallel;
  statements > 20 pages are chunked by page range.

Output schema:

```ts
type ProposedCard = {
  tempId: string
  type: 'income' | 'expense'
  description: string
  amountCents: number          // always positive; sign determines `type`
  date: string                 // ISO yyyy-mm-dd
  category: string             // existing name, or a new suggestion
  isNewCategory: boolean
  recurrence?: {
    frequency: 'weekly' | 'monthly'
    interval: number
    dayOfMonth?: number
    weekday?: number
    endsAfter?: number
  }
  notes?: string
  confidence: 'high' | 'low'
  sourceRef: string            // "Transactions!A12", "page 3", "receipt"
  skipReason?: string          // e.g. "template example row", "payment to card"
}

type ExtractResult = {
  documentKind: 'ledger' | 'bank_statement' | 'card_statement' | 'receipt' | 'unknown'
  cards: ProposedCard[]
  warnings: string[]
}
```

The server validates model output with the same shape (zod or Convex `v`
validators mirrored) and drops invalid rows into `warnings` rather than failing
the whole import.

### 5.4 Document-type rules (in prompt + post-processing)

- **Ledger spreadsheets:** one row → one card; `Recurring` sheets → one card with
  `recurrence`, dated at the next occurrence ≥ today (the recurrence engine rolls
  the series forward from there).
- **Bank statements:** debits → expense, credits → income. Skip transfers between
  own accounts, opening/closing balances and interest summaries (flag low confidence).
- **Credit-card statements:** charges → expense; payments to the card and refunds
  flagged (`skipReason`) since they double-count bank-side expenses.
- **Receipts:** exactly one expense card; merchant → description, total (incl. tax)
  → amount, line items summarised into `notes`.

### 5.5 Status assignment

Imported items are mostly historical, so status is derived from date:

| Type | date < today | date ≥ today |
| --- | --- | --- |
| expense | `paid` (`completedAt = date`) | `upcoming` / `due` per existing promote rules |
| income | `received` | `expected` |

Editable per row in the review table.

### 5.6 Duplicate detection

Client calls a new query `imports.findDuplicates({ candidates })` with
`{ tempId, amountCents, date, type }[]`. Server scans `by_user_date` over the
min–max date range (±3 days) and matches on same type, same `amountCents`,
date within ±3 days (optionally fuzzy description match). Returns
`tempId → existing card id`. Matching rows default to unchecked.

## 6. Backend changes (Convex)

Read `convex/_generated/ai/guidelines.md` before implementing.

### 6.1 Schema

```ts
imports: defineTable({
  userId: v.string(),
  fileName: v.string(),
  documentKind: v.string(),
  cardCount: v.number(),
  createdAt: v.number(),
  undoneAt: v.optional(v.number()),
}).index('by_user', ['userId']),
```

`cards` gets `importId: v.optional(v.id('imports'))` plus index
`by_import: ['importId']`. The existing `source` field is set to
`import:<fileName>` for display.

### 6.2 `convex/imports.ts`

- `findDuplicates` — query, described above.
- `commit` — mutation `{ fileName, documentKind, cards: ProposedCardInput[], newCategories: string[] }`:
  - `requireUserId`
  - cap at 1,000 cards per call (client batches if more)
  - add new categories via the same logic as `categories.add`
  - insert cards through the same helper `cards.create` uses (cents, order,
    series setup for recurrence) — extract that helper into `convex/lib.ts`
    rather than duplicating it
  - insert `imports` row, return `importId`
- `undo` — mutation `{ importId }`: verifies ownership, deletes cards by
  `by_import` (in pages if large), sets `undoneAt`.
- `list` — query of recent imports for a settings "Import history" section.

### 6.3 Tests

`convex/imports.test.ts` with convex-test:

- commit creates cards with correct cents/status/series fields
- recurring proposal creates a valid series
- undo removes only that import's cards; other user cannot undo
- findDuplicates matches within ±3 days and ignores other users' cards

### 6.4 Apple Pages / Numbers

`.pages` and `.numbers` are zipped IWA (protobuf) bundles with no stable public
spec. v1 handling:

- Detect by extension; if the bundle contains `preview.jpg` / `QuickLook/Preview.pdf`,
  send that to the image/PDF path with a "may be low resolution" warning.
- Otherwise show: "Export from Pages/Numbers as PDF or Excel, then import."

## 7. Frontend changes

- `src/components/board/ImportDialog.tsx` — dropzone, progress states, review table.
- `src/components/board/useImport.ts` — extraction, calls to `/api/import/extract`,
  duplicate lookup, commit/undo. Review rows are local state seeded from the
  extract response; nothing derived is mirrored via effects.
- `src/lib/import/extractSpreadsheet.ts` — SheetJS wrapper (dynamic `import()`).
- `src/routes/api.import.extract.ts` — server route.
- `BoardToolbar.tsx` — Import button; `settings.tsx` — import history with undo.

## 8. Security & privacy

- Route requires a session; Convex writes use the user's JWT (same as chat).
- Files are not persisted in v1 — processed in memory and discarded. Statements
  contain account numbers; the prompt instructs the model not to copy account
  or card numbers into descriptions/notes, and the server masks digit runs ≥ 8
  before returning.
- Document contents are sent to Gemini; the dialog states this before upload.
- Treat document text as data: prompt-injection in a PDF can only affect the
  proposed rows, which the user reviews, and the model has no tools on this route.
- Size/row limits enforced on both client and server.

## 9. Open questions

1. Offer to import the `Budgets` sheet into `budgets` in the same flow, or a separate step?
2. Should recurring rows from a ledger replace an existing matching series (same
   description + amount) instead of creating a new one?
3. Keep the original file in Convex storage for audit ("view source")? Adds
   retention/privacy considerations.
4. Remember per-user column mappings for repeated imports of the same template to
   skip the model call?

## 10. Rollout plan

| Phase | Scope |
| --- | --- |
| 1 | Spreadsheet/CSV import, review table, commit/undo, duplicates |
| 2 | PDF statements (bank + credit card), chunking |
| 3 | Receipt images, HEIC, Pages/Numbers preview fallback |
| 4 | Import history UI, budgets import, saved mappings |

## 11. Validation

- `vp check` and `vp test` pass.
- Manual: import `Monthly_Finance_Tracker.xlsx` — template example rows are
  skipped, Mortgage / IRS back taxes become recurring series, re-importing the
  same file flags every row as a duplicate, undo restores the prior board.
