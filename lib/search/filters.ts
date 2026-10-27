// URL query <-> search filters. Invalid values are dropped (and reported) rather
// than passed to the database, so any shared URL renders something sensible.

export const PAGE_SIZE = 12;
const MAX_PAGE = 500;

export interface SearchFilters {
  listing: "sale" | "rent";
  region?: string;
  type?: string;
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

function wholeNumber(raw: string, max: number): number | undefined | null {
  if (raw === "") return undefined;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

export function parseFilters(params: RawSearchParams): { filters: SearchFilters; invalid: boolean } {
  let invalid = false;
  const take = <T,>(value: T | null | undefined): T | undefined => {
    if (value === null) invalid = true;
    return value ?? undefined;
  };

  const listingRaw = first(params.listing);
  const listing = listingRaw === "rent" ? "rent" : "sale";
  if (listingRaw !== "" && listingRaw !== "sale" && listingRaw !== "rent") invalid = true;

  const regionRaw = first(params.region);
  const region = take(regionRaw === "" ? undefined : regionRaw.length <= 100 ? regionRaw : null);
  const typeRaw = first(params.type).toLowerCase();
  const type = take(typeRaw === "" ? undefined : /^[a-z][a-z -]{0,49}$/.test(typeRaw) ? typeRaw : null);

  let minPrice = take(wholeNumber(first(params.minPrice), 100_000_000));
  let maxPrice = take(wholeNumber(first(params.maxPrice), 100_000_000));
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }
  const beds = wholeNumber(first(params.minBeds), 10);
  const minBeds = take(beds === 0 ? undefined : beds);
  const page = take(wholeNumber(first(params.page), MAX_PAGE)) ?? 1;

  return {
    filters: { listing, region, type, minPrice, maxPrice, minBeds, page: Math.max(1, page) },
    invalid,
  };
}

/** Serialises filters to a query string, omitting defaults, for links and pagination. */
export function filtersToQuery(filters: Partial<SearchFilters>): string {
  const q = new URLSearchParams();
  if (filters.listing && filters.listing !== "sale") q.set("listing", filters.listing);
  if (filters.region) q.set("region", filters.region);
  if (filters.type) q.set("type", filters.type);
  if (filters.minPrice !== undefined) q.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice !== undefined) q.set("maxPrice", String(filters.maxPrice));
  if (filters.minBeds !== undefined) q.set("minBeds", String(filters.minBeds));
  if (filters.page && filters.page > 1) q.set("page", String(filters.page));
  const s = q.toString();
  return s ? `?${s}` : "";
}
