"""Generate a Power BI Project (.pbip) for the dashboard CSVs: semantic model (TMDL) with
both tables, the relationship and measures, plus a blank report page.

    python3 powerbi_project.py      # -> out/powerbi/BidMagnet_PowerBI/ (+ .zip)

Open BidMagnet.pbip in Power BI Desktop (Windows), set the DataFolder parameter to the
folder holding tenders.csv/results.csv (Transform data -> Manage parameters), refresh,
then File -> Save as -> .pbix if you need a single file.
"""

from __future__ import annotations

import csv
import json
import shutil
import uuid
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "out" / "powerbi"
PROJ = SRC / "BidMagnet_PowerBI"
NAME = "BidMagnet"

TYPES = {  # column -> (tmdl dataType, M type, summarizeBy, formatString)
    "budget_eur": ("double", "type number", "sum", "#,0"), "estimated_value_eur": ("double", "type number", "sum", "#,0"),
    "award_amount_eur": ("double", "type number", "sum", "#,0"), "lowest_bid_eur": ("double", "type number", "none", "#,0"),
    "highest_bid_eur": ("double", "type number", "none", "#,0"), "discount_pct": ("double", "type number", "none", "0.0%"),
    "price_weight_pct": ("double", "type number", "none", "0"), "duration_months": ("double", "type number", "none", "0.0"),
    "bids_received": ("int64", "Int64.Type", "none", "0"), "sme_bids_received": ("int64", "Int64.Type", "none", "0"),
    "n_lots": ("int64", "Int64.Type", "none", "0"),
    "deadline_date": ("dateTime", "type date", "none", "yyyy-mm-dd"), "last_update_date": ("dateTime", "type date", "none", "yyyy-mm-dd"),
    "award_date": ("dateTime", "type date", "none", "yyyy-mm-dd"),
}
MEASURES = {
    "tenders": [
        ("Tenders", "COUNTROWS(tenders)", "#,0"),
        ("Open Tenders", 'CALCULATE([Tenders], tenders[status] = "Open for bids")', "#,0"),
        ("Total Budget (€)", "SUM(tenders[budget_eur])", "#,0"),
        ("Avg Budget (€)", "AVERAGE(tenders[budget_eur])", "#,0"),
        ("Distinct Buyers", "DISTINCTCOUNT(tenders[buyer_nif])", "#,0"),
    ],
    "results": [
        ("Awards", "COUNTROWS(results)", "#,0"),
        ("Awarded Value (€)", "SUM(results[award_amount_eur])", "#,0"),
        ("Median Bidders", "MEDIAN(results[bids_received])", "0.0"),
        ("Avg Bidders", "AVERAGE(results[bids_received])", "0.0"),
        ("% Single-Bid Awards", 'DIVIDE(CALCULATE([Awards], results[bids_received] = 1), CALCULATE([Awards], NOT ISBLANK(results[bids_received])))', "0.0%"),
        ("Median Discount", "MEDIAN(results[discount_pct])", "0.0%"),
        ("% Won by SMEs", 'DIVIDE(CALCULATE([Awards], results[winner_is_sme] = "Yes"), CALCULATE([Awards], results[winner_is_sme] <> "Unknown"))', "0.0%"),
        ("Distinct Winners", "DISTINCTCOUNT(results[winner_nif])", "#,0"),
    ],
}


def tag() -> str:
    return str(uuid.uuid4())


def q(name: str) -> str:
    """Quote a TMDL object name when needed."""
    return f"'{name}'" if any(ch in name for ch in " ()€%-.'") else name


def table_tmdl(table: str, columns: list[str]) -> str:
    lines = [f"table {table}", f"\tlineageTag: {tag()}", ""]
    for name, expr, fmt in MEASURES.get(table, []):
        lines += [f"\tmeasure {q(name)} = {expr}", f"\t\tformatString: {fmt}", f"\t\tlineageTag: {tag()}", ""]
    for col in columns:
        dt, _, summ, fmt = TYPES.get(col, ("string", "type text", "none", None))
        lines += [f"\tcolumn {col}", f"\t\tdataType: {dt}"]
        if fmt and dt != "string":
            lines.append(f"\t\tformatString: {fmt}")
        lines += [f"\t\tlineageTag: {tag()}", f"\t\tsummarizeBy: {summ}", f"\t\tsourceColumn: {col}", "",
                  "\t\tannotation SummarizationSetBy = Automatic", ""]
    types = ", ".join(f'{{"{c}", {TYPES.get(c, (None, "type text"))[1]}}}' for c in columns)
    lines += [
        f"\tpartition {table} = m",
        "\t\tmode: import",
        "\t\tsource =",
        "\t\t\t\tlet",
        f'\t\t\t\t    Source = Csv.Document(File.Contents(DataFolder & "{table}.csv"), [Delimiter=",", Columns={len(columns)}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),',
        "\t\t\t\t    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),",
        f'\t\t\t\t    Typed = Table.TransformColumnTypes(Promoted, {{{types}}}, "en-US")',
        "\t\t\t\tin",
        "\t\t\t\t    Typed",
        "",
        "\tannotation PBI_ResultType = Table",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    if PROJ.exists():
        shutil.rmtree(PROJ)
    model = PROJ / f"{NAME}.SemanticModel"
    defn = model / "definition"
    (defn / "tables").mkdir(parents=True)
    report = PROJ / f"{NAME}.Report"
    report.mkdir(parents=True)
    data = PROJ / "data"
    data.mkdir()

    cols = {}
    for t in ("tenders", "results"):
        shutil.copy(SRC / f"{t}.csv", data / f"{t}.csv")
        with (SRC / f"{t}.csv").open(encoding="utf-8-sig") as fh:
            cols[t] = next(csv.reader(fh))
        (defn / "tables" / f"{t}.tmdl").write_text(table_tmdl(t, cols[t]), encoding="utf-8")

    (PROJ / f"{NAME}.pbip").write_text(json.dumps({
        "version": "1.0", "artifacts": [{"report": {"path": f"{NAME}.Report"}}],
        "settings": {"enableAutoRecovery": True}}, indent=2), encoding="utf-8")
    (model / "definition.pbism").write_text(json.dumps({"version": "4.0", "settings": {}}, indent=2), encoding="utf-8")
    (defn / "database.tmdl").write_text("database\n\tcompatibilityLevel: 1567\n", encoding="utf-8")
    (defn / "model.tmdl").write_text("\n".join([
        "model Model", "\tculture: en-US", "\tdefaultPowerBIDataSourceVersion: powerBI_V3",
        "\tsourceQueryCulture: en-US", "\tdataAccessOptions", "\t\tlegacyRedirects", "\t\treturnErrorValuesAsNull", "",
        "ref table tenders", "ref table results", ""]), encoding="utf-8")
    (defn / "expressions.tmdl").write_text("\n".join([
        r'expression DataFolder = "C:\BidMagnet_PowerBI\data\" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
        f"\tlineageTag: {tag()}", "", "\tannotation PBI_ResultType = Text", ""]), encoding="utf-8")
    (defn / "relationships.tmdl").write_text("\n".join([
        f"relationship {tag()}", "\tfromColumn: results.tender_id", "\ttoColumn: tenders.tender_id", ""]), encoding="utf-8")

    (report / "definition.pbir").write_text(json.dumps({
        "version": "4.0", "datasetReference": {"byPath": {"path": f"../{NAME}.SemanticModel"}}}, indent=2), encoding="utf-8")
    (report / "report.json").write_text(json.dumps({
        "config": json.dumps({"version": "5.43"}), "layoutOptimization": 0, "resourcePackages": [],
        "sections": [{"config": "{}", "displayName": "Overview", "displayOption": 1, "filters": "[]",
                      "height": 720.0, "name": "ReportSection1", "visualContainers": [], "width": 1280.0}]},
        indent=2), encoding="utf-8")
    (PROJ / "README.txt").write_text(README, encoding="utf-8")

    zip_path = shutil.make_archive(str(SRC / "BidMagnet_PowerBI"), "zip", PROJ.parent, PROJ.name)
    print("project:", PROJ)
    print("zip:    ", zip_path)


README = r"""BidMagnet Power BI project
==========================
Needs Power BI Desktop on Windows (recent version).

1. Unzip this folder to C:\BidMagnet_PowerBI\  (then the data path already matches)
   - If you unzip elsewhere: open the project, Home -> Transform data -> Edit parameters
     -> DataFolder = the full path of the "data" folder, ending with a backslash.
2. Double-click BidMagnet.pbip  (if Desktop asks, enable File -> Options -> Preview
   features -> "Power BI Project (.pbip) save option").
3. Home -> Refresh. Both tables load (23,059 tenders, 27,312 results), already linked
   by tender_id, with measures: Tenders, Open Tenders, Total Budget (€), Avg Budget (€),
   Distinct Buyers, Awards, Awarded Value (€), Median Bidders, Avg Bidders,
   % Single-Bid Awards, Median Discount, % Won by SMEs, Distinct Winners.
4. Build the pages (see POWERBI_GUIDE.md in the repo), then File -> Save as -> .pbix
   if you need a single file.

If the project doesn't open, load data/tenders.csv and data/results.csv manually and
paste the measures from POWERBI_GUIDE.md.
"""

if __name__ == "__main__":
    main()
