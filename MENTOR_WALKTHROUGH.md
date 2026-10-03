# Real tender walkthrough – how BidMagnet reads it

**Tender:** Cemetery-management software (SaaS), La Vall d'Uixó council (Valencia)
**PLACSP id:** 20602902 · **Budget:** 3,704.18 € excl. VAT (25 months) · **Procedure:** simplified open ("abreviado") · **Deadline:** 20 Oct 2026, 23:59
**Documents:** PCAP (administrative terms, 93 pages) + PPT (technical specs, 24 pages)
**Example bidder:** "Soluciones Marta S.L.", a 25-person software company in Valencia with ISO 27001, no ENS, not yet in ROLECE

Everything below comes from the official documents. Each point has its page reference in the app, and all 47 references were checked against the PDFs.

---

## 0. Finding it (pain point: discovery)
- **Manually:** search PLACSP by keyword or sector code, then open each result. The platform's filters are poor.
- **BidMagnet:** it appears **#13 of 449 matches** for this company, scoring **85/100**, with the reasons:
  - ✅ sector match, keywords, Valencia region, turnover fine, 18 days to prepare, low competition at this buyer, simplified procedure
  - ❌ **mentions ENS security certification, which you don't have**
  - ⚠️ **register in ROLECE before the deadline**

## 1. Must-meet requirements (participation)
| Requirement | Detail | Page |
|---|---|---|
| **Economic + technical solvency** | **Not required.** The simplified procedure waives it, so a young company with no track record can bid | PCAP p.26 |
| Business classification | Not required | PCAP p.12 |
| **ROLECE registration** | Certificate required in the envelope | PCAP p.15 |
| **ENS security certification** | Required before go-live. **The documents contradict each other:** the PCAP says MEDIUM (p.74), the PPT says BASIC (p.8). ISO 27001 does **not** replace it | PCAP p.74 / PPT p.8 |
| Standard SaaS product | Must already exist on the market; no custom development | PCAP p.3 |
| Minimum service levels | 99% availability; critical incidents answered in 1 h, solved in 8 h | PPT p.9, p.12 |

## 2. Formula-scored criteria (100 of 100 points)
| Criterion | Points | How it's scored |
|---|---|---|
| Price | **70** | 70 × (your discount ÷ biggest discount). Bidding at the budget scores 0 |
| Availability ≥ 99.9% | 5 | Bands |
| Critical response ≤ 30 min | 5 | Bands |
| Critical workaround ≤ 2 h | 5 | Bands |
| Critical resolution ≤ 4 h | 5 | Bands |
| Extra training hours | 10 | ≥ 8 extra hours = 10 |

**Abnormally low bids:** the art. 85 RGLCAP rule applies (e.g. with 1 bidder, more than 25% below budget is presumed abnormal).

> The structured data on the platform only says "100 points, objective criteria". **The breakdown above exists only in the PDF**, which is why BidMagnet reads the documents.

## 3. Judgement criteria (quality of the technical proposal)
**None.** Everything is scored by formula, so there's **no long technical proposal to write**. Only a short compliance sheet is needed (PCAP p.15). That makes this a low-cost bid.

*Contrast:* in the **AI chatbot tender (Canary Islands, 50.7k €)**, 40% of the points are quality criteria, and the price formula is logarithmic, so even a 20% discount gains only about 1.2 points. That tender is decided on certificates and the project manager's very specific experience.

## 4. Gaps for this company
1. **ENS certification**, plus clarifying which level. Usually takes months, so either partner with an ENS-certified SaaS provider or ask the council for clarification before the deadline.
2. **ROLECE registration** must be done before 20 Oct.
3. Everything else is met.

## 5. What to submit (single envelope)
- **With the bid (9 items):** Annex II declaration, DEUC, Annex III (labour agreement), Annex V (no conflict of interest), Annex VI (servers), ROLECE certificate, **Annex I price offer**, technical compliance sheet, ENS commitment (plus the UTE agreement if bidding jointly).
- **Only if you win (within 7 business days):** deeds, power of attorney, tax and Social Security certificates, equality plan (if more than 50 staff), bank details, Annexes IX/XIII/XV, server-location declaration, ENS certificate before go-live.
- **Limits:** whole bid ≤ 38 MB; each signed file ≤ 5 MB.

## 6. Ways to get thrown out (8 found)
- Price above 3,704.18 €
- Service levels below the minimums
- Product missing a mandatory function
- Not submitted through PLACSP
- Documents not in Spanish or Valencian
- Bid over 38 MB
- Two bids, or a solo bid plus a joint (UTE) bid
- An incomplete "HUELLA ELECTRÓNICA" submission not finished within 24 h

## 7. Competition and price (pain point: bidding blind)
- **This buyer:** 11 IT tenders; **median 1 bidder**; median discount 2%. Top past supplier: T-Systems.
- **Similar past tenders (matched by meaning):**
  - **Maintenance** of existing cemetery software: the incumbent vendor renews with **1 bidder and a 0% discount** (ATM Grupo Maggioli in Gibraleón, Jumilla and Villalbilla; others elsewhere).
  - **New implementation** (like this one): El Campello had **5 bidders; the winner bid 28% below budget**.
- **Takeaway:** new implementations are winnable and competitive. Once a vendor is installed, it tends to keep the contract. Winning this one means years of follow-on maintenance.

## 8. Real bid results: what decides tenders (from award reports)
Across 9 tenders and 115 bids that we read in full:
- **Paperwork kills bids.** In an Aragón AI tender, **9 of 19 bids were excluded**: price info in the wrong envelope, technical score below the minimum, unjustified low price.
- **When every bidder maxes the non-price criteria, price decides.** Example: a 329k € Alicante contract went to a local SME bidding 45% below budget; Telefónica came 8th.
- **Partners matter.** A joint bid (UTE Daleph–Cetenma) won the Torre Pacheco technical-assistance tender with a perfect technical score, without being the cheapest.

---

## Where BidMagnet helps along the mentor's journey
| Step | Pain point | BidMagnet today |
|---|---|---|
| Discovery | Hard to search and filter | Daily feed + fit score with reasons + meaning-based matching |
| Eligibility / solvency | Young firms can't prove experience | Flags gaps, and flags **small simplified tenders where solvency proof is usually waived** (99 open ones for this company), a way to build a track record |
| Partners | 15–30 days to find one | **Partner finder:** companies that won similar tenders nearby, with wins big enough to prove experience. For this tender it suggests e.g. Adelante Servicios Informáticos, who won El Campello's cemetery-software implementation |
| Understanding documents | Must-meet vs. scored vs. judgement | Cited checklist split exactly this way, with contradictions flagged |
| Proposal / cost of losing | Expensive, uncertain | Shows the criteria you'll compete on, the typical winning discount and why others lost |
