# BidMagnet web app: how the frontend works

**Code:** `web/` (Next.js 16, React 19, TypeScript)
**Branches:**
- `chapero/company-page`: Miguel's app
- `jyothika/frontend`: a copy of it with Jyothika's additions, merged into Miguel's work via pull request

**Backend:** everything comes from our Supabase database (see `BACKEND_STACK.txt` and `data-pipeline/API.md`). The app has no database of its own.

---

## 1. How it fits together
```
Browser (React pages)
  ├─ reads/writes Supabase directly with supabase-js  ← tenders, fit score, buyers, partners, decisions, company profile, documents
  └─ calls the app's own server routes (web/app/api/…)
        └─ OpenAI  ← AI summary, "Ask AI" chat, document reading, website research
```
- **Login:** Supabase Auth with an email magic link. Users only ever see their own company data (enforced by the database).
- **Settings** in `web/.env.local` (never committed):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: the **publishable** key, never the secret one
  - `OPENAI_API_KEY`: only for the AI features; everything else works without it

**Run it locally:**
```
cd web
npm install --no-package-lock
npm run dev        # http://localhost:3000
npm test           # 79 tests
```

## 2. The pages (the user's journey)

| Page | What the user does | Main pieces | Backend used |
|---|---|---|---|
| **Login** `/login` | Enters email, gets a sign-in link | `LoginForm` | Supabase Auth |
| **Welcome / onboarding** `/welcome` | Company name + website → BidMagnet researches the website and pre-fills the profile → guided steps (what you do, regions, finances, registrations, certificates, documents) | `Onboarding`, `steps`, `DocumentsStep` | `companies`, `company_documents`, storage; **AI:** website research |
| **Discover** `/discover` | Feed of open tenders ranked by fit score, with reasons. Filters (work type, contract, procedure, budget, region, deadline), sort, tabs (Open / Interested / Renewals / Prior notices / Dismissed). **Search box**, and below it more open tenders matching the words *outside* your matches. Side pane with an AI summary | `DiscoverFeed`, `FilterBar`, `TenderPane`, `TenderSummaryBlock`, `SearchAllTenders` *(new)* | `match_tenders`, `tenders`, `upcoming_renewals`, `tender_decisions`, `search_tenders` *(new)*; **AI:** summary |
| **Triage (swipe mode)** in Discover | One tender at a time, like Tinder: **swipe right = Interested, left = Not for us** (pick a reason), or Later. Buttons and keyboard also work; there's undo | `FocusMode` | `tender_decisions` |
| **Pipeline** `/pipeline` | Tenders you're interested in, by deadline | `PipelineList` | `tender_decisions`, `tenders` |
| **"Should we bid?"** `/pipeline/[id]` | Full decision page for one tender (panels below) + Go / Watch / No-go buttons + **Ask AI** side chat | `TenderDecision` + panels, `TenderChat` | see below |
| **Company** `/company` | The profile as a ledger of facts (value, status, proof), gaps rail ("what holds your matches back"), document vault with AI reading of certificates, website import | `CompanyLedger`, `FactRow`, `GapRail`, `DocumentsPanel`, `WebsiteImport` | `companies`, `company_documents`, storage, `match_tenders`; **AI:** document extraction, research |
| **Bid prep** `/bid-prep/[id]` | Price simulator + proposal outline and AI draft. **Logic ready** (`lib/price-sim.ts`, `lib/draft-outline.ts`, `lib/bid-prep-server.ts`, `POST /api/tenders/[id]/draft`); screen to be built by Miguel, see `BID_PREP_HANDOVER.md` | n/a | same as the decision page; **AI:** draft |
| **Outcomes** | Not built yet (greyed out in the menu) | n/a | n/a |

### The "Should we bid?" page, panel by panel
| Panel | Answers | Backend |
|---|---|---|
| **Fit** | Score 0–100 and the reasons (✓ / ! / ✗) | `match_tenders` |
| **Buyer** | How this buyer behaves: past awards, bidders, discounts | `buyer_stats`, `tender_results` |
| **Who wins this kind of work** | Likely rivals from similar contracts and this buyer | `similar_tenders`, `buyer_stats` |
| **Price** | Price weight, the typical winning discount, the price formula when known | `tender_criteria`, checklist, past awards |
| **Can you bid, and how will you be scored?** *(new)* | The mentor's split: **1. must-meet requirements, 2. formula criteria, 3. judgement criteria**, plus what to submit, how bids get excluded, contradictions to check. Cited to the PDF page when a checklist exists, otherwise built from the official notice data (works for every tender) | `tender_extractions`, `tender_criteria`, `tender_requirements`, `tender_documents` |
| **Bid with a partner** *(new)* | Companies that won the most similar contracts: same region, wins big enough to prove experience, SME, an example contract | `partner_candidates` |
| **Ask AI** (side chat) | Questions about the tender, answered from its PDFs with page citations and compared to your profile | server route → OpenAI |

## 3. Requirements check
### Concept document (product functionality table)
| Stage | Feature | Status |
|---|---|---|
| Discovery | Company profile | ✅ Onboarding + Company page |
| | Unified feed (national + regional) | ✅ Discover; regional platforms included in the data |
| | Semantic matching | ✅ Fit score uses meaning similarity (backend) |
| | Renewal radar | ✅ Discover "Renewals" tab |
| | Early signals (prior notices) | ✅ Discover "Prior notices" tab |
| | Amendment tracking (alerts) | ❌ No alerts or emails yet |
| Qualification | Eligibility check | ✅ Fit reasons + Company gaps + breakdown "must meet" |
| | Registry readiness (ROLECE) | ✅ Profile status + fit warning |
| | Buyer & incumbent profile | ✅ Buyer panel |
| | Competition estimate | ✅ "Who wins this kind of work" |
| | Fit score | ✅ |
| Decision | Go / no-go and pipeline | ✅ Decision buttons, swipe, Pipeline |
| | Partner finder | ✅ "Bid with a partner" *(new)* |
| Bid preparation | Tender breakdown + checklist with page citations | ✅ Breakdown *(new)*. Full cited detail only for tenders with a checklist (3 so far) |
| | Document vault + admin pack | 🟡 Vault + certificate reading ✅; auto-assembled admin pack ❌ |
| | Technical proposal drafting | 🟡 Outline + AI draft logic ready; screen pending (Miguel) |
| | Price simulator | 🟡 Simulator logic ready (formula, abnormally-low rule, rivals); screen pending (Miguel) |
| | Collaboration and export | ❌ |
| Outcome | Award tracking, win/loss | ❌ ("Outcomes", not built). Bid-results data exists for 9 tenders |

### Mentor's feedback
| Mentor asked | Where in the app |
|---|---|
| Discovery is hard on the official platform | Discover feed, filters, search, swipe triage |
| Eligibility / solvency (the vicious circle) | Fit reasons incl. "small simplified tender: no solvency proof needed"; breakdown "must meet" |
| Finding partners quickly | "Bid with a partner" panel |
| Understanding the documents: must-meet vs formula vs judgement | "Can you bid, and how will you be scored?" |
| Cost of preparing losing bids | Fit score and gaps before investing; bid results data (not shown in the UI yet) |
| Map DoubleTrade along the journey | Team task (not in the app) |

## 4. Who built what
- **Miguel:**
  - the app itself: login, onboarding, Discover, swipe mode, Pipeline, decision page (Fit, Buyer, Rivals, Price), AI chat and summaries, Company page and document vault
  - the original design
- **Jyothika** (`jyothika/frontend`):
  - team colour palette (off-white `#F8F7F1`, deep green `#0A4A3A`, olive `#30361F`, black)
  - "Can you bid, and how will you be scored?" breakdown
  - "Bid with a partner" panel
  - search across all open tenders
  - Bid prep engine: price simulator and proposal drafting logic (UI by Miguel)
  - plus the entire backend and data pipeline the app runs on

## 5. Good to know
- **AI features need `OPENAI_API_KEY`**, and each call costs money. Without it, summaries, chat, document reading and website research show an error. The rest of the app works.
- **Code conventions:**
  - logic lives in `web/lib/*.ts` with a test next to it (`*.test.ts`)
  - screens live in `web/components/…`
  - all colours are tokens at the top of `web/app/globals.css`
- **Don't change the database from the frontend** (see `BACKEND_STACK.txt`). Ask for new fields instead.
