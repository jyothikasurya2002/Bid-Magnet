# BidMagnet web app: how to run it and what's in it

The app lives in `web/`. It's built with Next.js 16, React 19 and TypeScript. All of its data comes from the team's Supabase database; for the backend details, see `BACKEND_STACK.txt` and `data-pipeline/API.md`.

## 1. Run it on your laptop
You need **Node.js 20+** (on a Mac: `brew install node`).

```
cd web
npm install --no-package-lock
npm run dev
```
Open **http://localhost:3000** and sign in with your email. You'll get a sign-in link by email; open it in the same browser.

**Settings:** create `web/.env.local` (never commit it). Ask the team for the values.
```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...     # the "publishable" key, never the secret one
OPENAI_API_KEY=...                    # optional: only the AI features need it
```
Without `OPENAI_API_KEY` the app still works. The AI summary, chat, document reading, website research and AI draft show a short "unavailable" message instead.

**Checks before sharing changes:**
```
npx next typegen && npm run typecheck   # types
npm test                                # 95 tests
npm run lint
npm run build                           # production build
```

## 2. The pages (the user's journey)

| Page | What the user does |
|---|---|
| **Login** `/login` | Enters an email and gets a sign-in link. |
| **Company** `/welcome`, `/company` | Builds the profile: company name and website (BidMagnet researches the website and pre-fills it), what you do, regions, finances, registrations (ROLECE, classification), certificates and documents. Also offers to import your past public contract wins. The page shows what is missing and holds back your matches. |
| **Discover** `/discover` | Open tenders ranked by fit score (0–100), with the reasons. Filters, sorting, and tabs: Open, Interested, Renewals (contracts ending soon), Prior notices, Dismissed. A warning shows when a tender looks **meant for someone** (one-bid buyers, a usual winner). A side pane gives an AI summary. |
| **Swipe mode** (in Discover) | One tender at a time: **right = Interested, left = Not for us**, or Later. Includes undo. |
| **Pipeline** `/pipeline` | The tenders you're interested in, by deadline. |
| **"Should we bid?"** `/pipeline/[id]` | The decision page: Fit score, Buyer (past awards, bidders, discounts), Who wins this kind of work, and Your track record. It has Go / Watch / No-go buttons and an AI assistant that answers from the tender's PDFs with page references. |
| **Bid prep** `/bid` | Every tender you're bidding on, closest deadline first, with your open to-dos. |
| **Bid plan** `/bid/[id]` | Three tabs: **Plan** lists the tasks with dates, what could get you excluded, and what to submit. **Price** is the price simulator. **Proposal** is the proposal outline, with an optional AI first draft. |
| **Outcomes** | Not built yet (greyed out in the menu). |

### Price simulator
- **What it answers:** "If we bid X % below the budget, how many price points do we get, and would we be flagged as abnormally low?"
- **Formula:** it uses the tender's own price formula when the cited checklist has it. There are four types: lowest offer ÷ your offer, your discount ÷ biggest discount, linear, and logarithmic, with a discount cap where one applies.
- **Abnormally-low limit:** it applies the legal rule (art. 85 RGLCAP) by default, or the tender's own rule when the checklist states one.
- **Rivals:** it estimates them from this buyer's past winning discounts and similar contracts, then suggests a safe discount and the best-scoring one.
- **Where the code is:** the logic is in `web/lib/price-sim.ts` and the screen in `web/components/bid/PriceSimulator.tsx`.

### Proposal outline and AI draft
- **Outline (free, no AI):** one section per scored criterion, most points first. Each section says what to write, which of your certificates help, and the `[ADD: …]` gaps to fill. You can copy it as text.
- **AI first draft** (`POST /api/tenders/[id]/draft`, Spanish or English): written on the same outline. It never invents company facts; anything missing comes back as `[ADD: …]`.
- **Where the code is:** the logic is in `web/lib/draft-outline.ts` and `web/lib/proposal-draft.ts`, and the screen in `web/components/bid/ProposalOutline.tsx`.

## 3. How it fits together
```
Browser (React pages)
  ├─ reads/writes Supabase directly (supabase-js): tenders, fit score, buyers,
  │  decisions, company profile, documents. Each user sees only their own company.
  └─ calls the app's own server routes (web/app/api/…)
        └─ OpenAI: summaries, chat, document reading, website research, drafts
```
- **Code layout:** logic lives in `web/lib/*.ts` with a test next to it (`*.test.ts`), and screens live in `web/components/…`. Colours are tokens at the top of `web/app/globals.css`. Don't change them without the app owner.
- **Database:** don't change it from the app (see `BACKEND_STACK.txt`, section 5). Ask the team for new fields instead.
- **Cost:** AI features cost a little per call; everything else is free.

## 4. Known limits
- The app isn't deployed online yet. It runs locally (`npm run dev`).
- Cited checklists exist for 3 tenders, and full bid results for 9. Other tenders use the official notice data, so the price formula there is a best guess and is labelled as one.
- Outcomes (win/loss tracking), buyer contact details and email alerts are next on the list (see `progress.txt`, section 6).
