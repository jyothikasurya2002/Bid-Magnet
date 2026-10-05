import { describe, expect, it } from "vitest";
import { outsideMatches, searchable, type SearchHit } from "./search-all";

const hit = (id: string): SearchHit => ({
  tender_id: id,
  title: `T ${id}`,
  buyer_name: null,
  region: null,
  status: "PUB",
  budget_no_tax: null,
  deadline_date: null,
  rank: 0.1,
});

describe("search beyond matches", () => {
  it("needs at least three characters", () => {
    expect(searchable("ab ")).toBe(false);
    expect(searchable("web")).toBe(true);
  });

  it("drops tenders already in the feed and duplicates, keeping rank order", () => {
    const result = outsideMatches([hit("a"), hit("b"), hit("a"), hit("c")], ["b"]);
    expect(result.map((h) => h.tender_id)).toEqual(["a", "c"]);
  });

  it("caps the list", () => {
    expect(outsideMatches(["1", "2", "3", "4"].map(hit), [], 2).map((h) => h.tender_id)).toEqual(["1", "2"]);
  });
});
