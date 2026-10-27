import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "@/lib/search/filters";

describe("parseFilters", () => {
  it("defaults to page 1 of listings for sale", () => {
    expect(parseFilters({})).toEqual({ filters: { listing: "sale", page: 1 }, invalid: false });
  });

  it("parses a full query", () => {
    const { filters, invalid } = parseFilters({
      listing: "rent", region: "Málaga", type: "Villa", minPrice: "1000", maxPrice: "3000", minBeds: "2", page: "3",
    });
    expect(invalid).toBe(false);
    expect(filters).toEqual({ listing: "rent", region: "Málaga", type: "villa", minPrice: 1000, maxPrice: 3000, minBeds: 2, page: 3 });
  });

  it("drops invalid values and reports them", () => {
    const { filters, invalid } = parseFilters({ minPrice: "abc", minBeds: "-1", page: "0x10", listing: "lease", type: "<script>" });
    expect(invalid).toBe(true);
    expect(filters).toEqual({ listing: "sale", page: 1 });
  });

  it("swaps an inverted price range instead of returning nothing", () => {
    expect(parseFilters({ minPrice: "500000", maxPrice: "100000" }).filters).toMatchObject({ minPrice: 100000, maxPrice: 500000 });
  });

  it("uses the first value of repeated params and caps the page", () => {
    expect(parseFilters({ region: ["Alicante", "Málaga"] }).filters.region).toBe("Alicante");
    expect(parseFilters({ page: "100000" })).toMatchObject({ filters: { page: 1 }, invalid: true });
  });
});

describe("filtersToQuery", () => {
  it("omits defaults and round-trips through parseFilters", () => {
    expect(filtersToQuery({ listing: "sale", page: 1 })).toBe("");
    const q = filtersToQuery({ listing: "rent", region: "Islas Baleares", minBeds: 2, page: 2 });
    expect(q).toBe("?listing=rent&region=Islas+Baleares&minBeds=2&page=2");
    const params = Object.fromEntries(new URLSearchParams(q));
    expect(parseFilters(params).filters).toEqual({ listing: "rent", region: "Islas Baleares", minBeds: 2, page: 2 });
  });
});
