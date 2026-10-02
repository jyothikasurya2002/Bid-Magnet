# BidMagnet data API (for the frontend)

All data is in Supabase. There's no separate backend server: the Next.js app reads tables and calls functions directly with `supabase-js`.

## Setup
```ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,      // Supabase → Project Settings → API → Project URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!  // same page → anon public key (safe in the browser)
)
```

**Every query needs a signed-in user** (Supabase Auth, email login). Logged-out visitors get empty results by design.

A shared demo company exists for the showcase. Every signed-in user can read it:

```
00000000-0000-0000-0000-000000000001   "Soluciones Marta S.L. (demo)"
```

---

## Screen 1: Company profile (`companies`)
Each user sees and edits only their own companies, plus the demo company (read-only).

```ts
// create
const { data } = await supabase.from('companies').insert({
  name: 'Mi Empresa S.L.',
  cpv_prefixes: ['7221', '7226', '48'],      // sector codes (prefix match)
  keywords: ['software', 'web', 'cloud'],    // matched in tender titles
  regions: ['Comunitat Valenciana'],         // [] = anywhere
  include_national: true,
  annual_turnover: 1500000,
  employees: 25,
  certifications: ['ISO27001'],              // ISO27001 | ISO9001 | ISO14001 | ENS_BASICA | ENS_MEDIA | ENS_ALTA
  has_classification: false,
  rolece: false,
  max_budget: 600000,
}).select().single()

// list mine (+ demo)
const { data: companies } = await supabase.from('companies').select('*')
```
- `owner` is filled automatically from the signed-in user.
- **Region names** must match these values: `Madrid`, `Comunitat Valenciana`, `Andalucía`, `Cataluña`, `País Vasco`, `Galicia`, `Canarias`, `Illes Balears`, `Castilla y León`, `Castilla-La Mancha`, `Aragón`, `Murcia`, `Asturias`, `Extremadura`, `Navarra`, `Cantabria`, `La Rioja`, `Ceuta`, `Melilla`, `Nacional`.

## Screen 2: "Tenders for you" (`match_tenders`)
```ts
const { data: matches } = await supabase.rpc('match_tenders', { p_company: companyId, p_limit: 50 })
```

Each row contains:

| Field | Meaning |
|---|---|
| `tender_id`, `title`, `buyer_name`, `region` | What and who |
| `budget_no_tax` | Budget excluding VAT |
| `deadline_date`, `days_left` | When bids close |
| `procedure_label`, `it_segment` | Procedure type, IT segment |
| `score` | Fit score, 0–100 |
| `reasons` | Why it got that score (see below) |
| `has_checklist` | `true` if a cited checklist exists (Screen 4) |
| `link` | The tender's page on PLACSP |

Rows are sorted best-first.

Each item in `reasons` looks like `{type: 'ok'|'warn'|'gap', points: number, text: string}`. Show `ok` in green, `warn` in amber and `gap` in red.

How the score is built (rule-based, every point has a reason):

| Factor | Points |
|---|---|
| Sector code match / keyword-only match | 30 / 10 |
| Keywords in title | up to +10 |
| Region: yours / national / anywhere | +15 / +10 / +10 |
| Turnover ≥ 1.5 × annual value (usual solvency rule) | +15, else −15 |
| ISO 27001, ISO 9001, ENS asked and missing | −10 each (+5 if held) |
| Business classification required and missing | −10 |
| Days left: ≥10 / 5–9 / 3–4 / <3 | +10 / +5 / 0 / −20 |
| Buyer's median bidders ≤2 / 3–4 / ≥5 | +10 / +5 / 0 |
| Simplified procedure | +5 |

The score is capped at 0–100. Certification requirements come from the XML and from the checklist when one exists. Otherwise the docs still need checking.

## Screen 3: Tender page
```ts
// the tender
const { data: t } = await supabase.from('tenders').select('*').eq('id', tenderId).single()

// award criteria (lot_id null = whole contract; subtype '1' = price)
const { data: criteria } = await supabase.from('tender_criteria').select('*').eq('tender_id', tenderId)

// requirements from the XML (kind: declaration | technical_solvency | financial_solvency | classification)
const { data: reqs } = await supabase.from('tender_requirements').select('*').eq('tender_id', tenderId)

// PDF links (kind: pcap = admin terms, ppt = tech specs, notice = award notices, additional,
// general = other official docs: "Memoria justificativa", "Acta del órgano de asistencia",
// "Informe de valoración..." (evaluation report with competitors' scores))
const { data: docs } = await supabase.from('tender_documents').select('kind,name,url').eq('tender_id', tenderId)

// buyer profile: "who you're up against"
const { data: buyer } = await supabase.from('buyer_stats').select('*').eq('buyer_nif', t.buyer_nif).maybeSingle()
```

`buyer_stats` fields:

| Field | Meaning |
|---|---|
| `it_tenders`, `open_tenders` | The buyer's IT tenders, total and open now |
| `awards` | Award results, counted per lot |
| `median_bidders` | Typical number of bids received |
| `median_discount` | 0.10 = 10% below budget. Competitive procedures only; **null if fewer than 3 awards** |
| `discount_sample` | How many awards the discount is based on |
| `last_award_date` | Most recent award |
| `top_winners` | `[{name, nif, wins}]`, up to 5 |

**Data window: January–September 2026.**

**Decisions** (Go / No-go / Watch), one per company and tender:
```ts
await supabase.from('tender_decisions').upsert(
  { company_id, tender_id, decision: 'go', reason: 'Good fit, need ROLECE', owner_name: 'Marta' },
  { onConflict: 'company_id,tender_id' })
```

## Screen 4: Cited bid checklist (`tender_extractions`)
```ts
const { data: ex } = await supabase.from('tender_extractions').select('output').eq('tender_id', tenderId).maybeSingle()
const checklist = ex?.output
```

Structure (full schema in `extract_tender.py` → `SCHEMA`):

| Section | Content |
|---|---|
| `summary` | `object_en`, `object_es`, `contract_type`, `budget_no_tax`, `duration`, `extensions`, `lots[]`, `submission` |
| `key_dates[]` | `label`, `date` |
| `envelopes[]` | `name`, `contents[]` |
| `mandatory_documents[]` | `name`, `description_en`, `envelope`, `when` (`with_bid` \| `awardee_only` \| `unclear`) |
| `eligibility[]` | `category`, `requirement_en`, `threshold`, `alternative` |
| `award_criteria[]` | `name`, `kind` (`price` \| `automatic_formula` \| `judgement`), `points`, `how_scored_en` |
| `price` | `formula`, `formula_explained_en`, `abnormally_low_rule`, guarantees |
| `exclusion_risks[]` | `risk_en` |
| `review_notes[]` | Plain strings: contradictions, risks, things a person must check |

**Every item** also has `doc`, `page`, `quote` and `verified`:
- To link to the PDF, find the URL in `tender_documents`. The `doc` label starts with the document kind: `pcap__…` matches kind `pcap`, `ppt__…` matches kind `ppt`. Open `url#page=N`.
- `doc: "placsp_xml"` means the fact comes from the platform's structured data, not a PDF page.
- Show `verified: false` items with a "check" badge.

Checklists exist today for: `20602902` (cemetery SaaS), `20571626` (AI chatbot), `20586307` (OT cybersecurity).

## Screen 5: Price simulator
There's no backend call. Use `checklist.price.formula` plus the buyer's `median_discount`.

As a market reference, the median discount in competitive procedures is about 10% (open) and 14% (simplified), June–Sept 2026.

## Search box (`search_tenders`)
Spanish-aware full-text search over title and buyer, so "aplicaciones" also matches "aplicación".

```ts
const { data } = await supabase.rpc('search_tenders', { q: 'mantenimiento web ayuntamiento', only_open: true, p_limit: 50 })
// -> tender_id, title, buyer_name, region, status, budget_no_tax, deadline_date, rank
```
- `q` accepts quotes and `-word` (websearch syntax).
- Set `only_open: false` to include past tenders.

## Competitor profiles (`competitor_stats`)
One row per company that won an IT award (January–September 2026).

```ts
// a competitor
const { data } = await supabase.from('competitor_stats').select('*').eq('nif', winnerNif).maybeSingle()
// top competitors overall
const { data: top } = await supabase.from('competitor_stats').select('*').order('awards', { ascending: false }).limit(20)
```

| Field | Meaning |
|---|---|
| `name` | Company name |
| `awards` | Awards, counted per lot |
| `tenders_won` | Distinct tenders won |
| `total_awarded_no_tax` | Total value won |
| `buyers` | Number of distinct buyers |
| `is_sme` | Whether it's flagged as an SME |
| `last_win` | Most recent win |
| `median_discount` | Competitive procedures only; null if fewer than 3 awards |
| `top_regions` | Its main regions |
| `top_buyers` | `[{name, nif, wins}]` |

Link from `buyer_stats.top_winners[].nif` or `upcoming_renewals.incumbent_nif`.

## Renewal radar (`upcoming_renewals`)
```ts
const { data } = await supabase.from('upcoming_renewals').select('*')
  .eq('it_segment', 'core').order('estimated_end').limit(50)
```

Each row is an awarded contract whose estimated end falls in the next 12 months:

| Field | Meaning |
|---|---|
| `incumbent`, `incumbent_nif` | Current contract holder |
| `award_amount_no_tax` | What it was awarded for |
| `estimated_end` | Planned end date, else start/award date + duration |

Treat `estimated_end` as an estimate.

## Data freshness
- **Updated once a day** by `.github/workflows/daily-ingest.yml` (needs the `DATABASE_URL` repo secret).
- PLACSP itself refreshes about once a day.
- `buyer_stats` is recalculated after every load.
