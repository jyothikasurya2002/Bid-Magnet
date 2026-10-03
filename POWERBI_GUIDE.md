# Power BI dashboard: Spanish public IT tenders (Jan–Sep 2026)

**Files:** `data-pipeline/out/powerbi/tenders.csv` and `data-pipeline/out/powerbi/results.csv`
(Regenerate with `python3 data-pipeline/powerbi_export.py`.)

| File | Rows | One row = |
|---|---|---|
| `tenders.csv` | 23,059 | One IT tender (latest status) |
| `results.csv` | 27,312 | One award result (a tender with lots has one row per lot) |

> ⚠️ **Mac users:** Power BI Desktop runs on **Windows only**. Options:
> - a university Windows PC or lab, or a Windows virtual machine;
> - **Power BI in the browser** (app.powerbi.com, sign in with your university account): *Create → Paste or manually enter data*, or upload the CSVs to OneDrive and use *Get data → Files*.
>
> Desktop gives you the most control (DAX measures, relationships).

---

## 1. Load the data
1. **Home → Get data → Text/CSV** → choose `tenders.csv`.
   - File origin: **65001: Unicode (UTF-8)**. Delimiter: **Comma**.
   - Click **Transform Data**.
2. Repeat for `results.csv`.
3. In Power Query, check these column types and change them if needed:

| Table | Column(s) | Type |
|---|---|---|
| both | `budget_eur`, `estimated_value_eur`, `award_amount_eur`, `lowest_bid_eur`, `highest_bid_eur` | Decimal number |
| both | `discount_pct`, `price_weight_pct`, `duration_months` | Decimal number |
| both | `bids_received`, `sme_bids_received`, `n_lots` | Whole number |
| both | `deadline_date`, `last_update_date`, `award_date` | **Date** |
| both | `tender_id`, `lot_id`, `winner_nif`, `buyer_nif` | **Text** (keep IDs as text) |

   - **Decimals or dates come out wrong?** On a Spanish or European laptop, select the column → **Change Type → Using Locale… → English (United States)**. The files use `.` for decimals and `YYYY-MM-DD` dates.
4. **Close & Apply.**

## 2. Data model
- **Model view:** drag `tenders[tender_id]` onto `results[tender_id]`.
  - **One-to-many** (tenders 1 → results \*), single direction.
- *(Optional)* a date table for time charts. **Modeling → New table:**
  ```DAX
  Calendar = CALENDAR(DATE(2022,1,1), DATE(2026,12,31))
  ```
  Then relate `Calendar[Date]` → `results[award_date]`, and mark it as a date table.

## 3. Measures (Modeling → New measure)
Put them in a measure table (Home → Enter data → name it `_Measures`):

```DAX
Tenders = COUNTROWS(tenders)

Open Tenders = CALCULATE([Tenders], tenders[status] = "Open for bids")

Total Budget (€) = SUM(tenders[budget_eur])

Avg Budget (€) = AVERAGE(tenders[budget_eur])

Awards = COUNTROWS(results)

Awarded Value (€) = SUM(results[award_amount_eur])

Median Bidders = MEDIAN(results[bids_received])

Avg Bidders = AVERAGE(results[bids_received])

% Single-Bid Awards =
DIVIDE(CALCULATE([Awards], results[bids_received] = 1),
       CALCULATE([Awards], NOT ISBLANK(results[bids_received])))

Median Discount = MEDIAN(results[discount_pct])

% Won by SMEs =
DIVIDE(CALCULATE([Awards], results[winner_is_sme] = "Yes"),
       CALCULATE([Awards], results[winner_is_sme] <> "Unknown"))

Distinct Winners = DISTINCTCOUNT(results[winner_nif])

Distinct Buyers = DISTINCTCOUNT(tenders[buyer_nif])
```
Format `% Single-Bid Awards`, `Median Discount` and `% Won by SMEs` as **Percentage** (Measure tools → %).

## 4. Pages (suggested layout)

### Page 1: Market overview
- **Cards:** Tenders · Open Tenders · Total Budget (€) · Distinct Buyers.
- **Map / filled map:** `tenders[region]` → size = Tenders. Set *Data category* of `region` to **State or Province**. Or use a bar chart (more reliable for Spanish regions).
- **Donut:** `it_segment` → Tenders.
- **Stacked bar:** `procedure` → Tenders, legend = `competitive_procedure`.
- **Column chart:** `budget_band` → Tenders. The bands are numbered so they sort correctly.
- **Slicers:** `data_source`, `region`, `it_segment`, `status`.

### Page 2: Competition & prices (the core story)
- **Cards:** % Single-Bid Awards · Median Bidders · Median Discount · % Won by SMEs.
- **Column chart:** `results[competition_band]` → Awards.
- **Clustered bar:** `tenders[procedure]` → Median Discount (filter `competitive_procedure` = Yes).
- **Scatter:** X = `budget_eur`, Y = `bids_received` (table `results`), details = `tender_id`. Bigger tenders don't always attract more bids.
- **Line chart:** `Calendar[Month]` → Awards (or `award_date` by month).
- **Slicers:** `region`, `it_segment`, `budget_band`.

### Page 3: Who wins
- **Table / bar:** `results[winner_name]` → Awards, Awarded Value (€). Top N filter = 15.
- **Table:** `tenders[buyer_name]` → Tenders, Median Bidders, Median Discount. Top N = 15.
- **Treemap:** `region` → Awarded Value (€).
- **Card:** Distinct Winners.

### Page 4 (optional): Open opportunities
- **Table:** `title`, `buyer_name`, `region`, `budget_eur`, `deadline_date`, `link`. Filter status = "Open for bids", sorted by deadline.
  - Set `link` *Data category* to **Web URL** to make it clickable.

## 5. Insights to present (they come out of this data)
- **About 42% of IT awards had a single bidder.** Competition is thin, so a prepared SME has a real chance.
- **Median discount in competitive procedures is about 10%.** Negotiated procedures without publicity show 0%.
- A few large integrators (Telefónica, Inetum, Indra, Orange, Vodafone) win the most value, but **about half of all awards (52%) go to SMEs**.
- **65% of IT tenders are under €150k:** the SME-sized market.
- Regional platforms add about 30% more tenders, mainly from Catalonia and the Basque Country.

## 6. Data notes (mention them; examiners like it)
- **Source:** the Spanish Public Sector Procurement Platform (PLACSP) open data, national + regional feeds. IT tenders are identified by EU CPV codes 72\*, 48\*, 302\*, 3242\* and 6421\*.
- **Time span:** tenders published or updated **Jan–Sep 2026**. Some awards date from earlier years (tenders still active in 2026).
- **~9,400 results have no award date**, mostly from regional platforms. They're excluded from date charts automatically.
- **`discount_pct`** = 1 − award ÷ budget of the same lot. It's only filled for competitive procedures, and outliers (unit-price contracts) are removed.
- **Masked tax IDs** (e.g. sole traders) are left blank.
