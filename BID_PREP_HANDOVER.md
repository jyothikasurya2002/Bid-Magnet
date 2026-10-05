# Bid prep: handover for the screen

The logic for the **Bid prep** page is built and tested. What's left is the screen. Everything below is on branch `jyothika/frontend` and arrives through the pull request.

## What's ready

| File | What it does |
|---|---|
| `web/lib/bid-prep-server.ts` | `loadBidPrep(supabase, tenderId, company)` loads everything the page needs in one call: tender, breakdown, price setup, rival assumptions, advice, and the proposal outline. Returns `null` if the tender doesn't exist. |
| `web/lib/price-sim.ts` | The price simulator. Pure functions, cheap enough to re-run on every slider move. |
| `web/lib/draft-outline.ts` | Proposal outline without AI. There is one section per scored criterion, most points first, each saying what to write, which company facts help, and the `[ADD: …]` gaps to fill. `outlineMarkdown()` gives copyable text. |
| `web/lib/proposal-draft.ts` + `POST /api/tenders/[id]/draft` | AI first draft written on the same outline. Body: `{ "language": "es" \| "en" }` (default `es`). Returns `{ sections: [{key, title, text, placeholders}], cautions }`, or `{ error }` with a readable message (no key, no credits). |

Tests: `lib/price-sim.test.ts`, `lib/draft-outline.test.ts`. There are 79 tests in total.

## Suggested page: `web/app/bid-prep/[id]/page.tsx`
```tsx
const { supabase, company } = await requireCompany();
const prep = await loadBidPrep(supabase, id, company);
if (!prep) notFound();
return <AppShell …><BidPrep prep={prep} /></AppShell>;   // BidPrep = your client component
```
- **Navigation:** give the `bid-prep` item in `AppShell` an href, and add a "Prepare bid" button on `/pipeline/[id]` that links to `/bid-prep/[id]`.

### 1. Price simulator (client component)
Keep `prep.price.setup` and `prep.price.market` in state, then:
```ts
const rows = simulate(setup, market.rivals);   // [{discount, offer, points, abnormal, best}] for 0–50 %
const advice = advise(setup, market);          // {safeMax, sweetSpot, atTypical, notes}
const mine = rows.find(r => r.discount === discount);
```
- **Slider:** your discount, 0–50 %. Show the offer in € (`row.offer`), the price points, and a red "abnormally low" badge when `row.abnormal` is true.
- **Chart:** points against discount from `rows`. Shade the area above `advice.safeMax` as the risk zone, and mark `advice.sweetSpot` and `advice.atTypical`.
- **Editable inputs:**
  - formula (`FORMULA_LABEL` gives the dropdown labels)
  - max points
  - budget
  - discount cap
  - number of rivals and their discounts (`market.rivals`)
  - the abnormal rule
- **Text to show:**
  - `prep.price.formulaText`, the real formula, when the tender has a checklist
  - `setup.formulaKnown === false`: show "Formula not confirmed, check the admin terms"
  - `market.basis`, which says where the rival assumptions come from
  - `advice.notes`
- `prep.price.history.buyer` and `prep.price.history.similar` hold the raw past discounts, if you want a dot plot.

### 2. Proposal
- Render `prep.outline.sections`:
  - title and points
  - `howScored`
  - `write` as bullets
  - `evidence` with ✓ marks
  - `gaps` highlighted
  - `cite` (same shape as the breakdown: link to the PDF page)
- Show `prep.outline.note` at the top, and `prep.outline.attach` as a checklist.
- A **"Copy outline"** button uses `outlineMarkdown(prep.tender.title, prep.outline)`.
- A **"Write a first draft with AI"** button:
  - calls `fetch("/api/tenders/" + id + "/draft", { method: "POST", body: JSON.stringify({ language }) })`
  - shows each section's `text`, with `[ADD: …]` highlighted, plus `cautions`
  - shows `error` if present

## Good to know
- Discounts are fractions everywhere: `0.12` means 12 % below the budget, excluding VAT.
- The abnormally-low rule defaults to art. 85 RGLCAP (the legal default) unless the checklist says otherwise. One example: the chatbot tender flags anything more than 20 % below the budget.
- The AI draft needs `OPENAI_API_KEY`, and each call costs a few cents. The draft is cached per tender, company version and language. Everything else on the page is free.
- The AI must not invent company facts. Anything missing comes back as `[ADD: …]`, so make those placeholders visible.
