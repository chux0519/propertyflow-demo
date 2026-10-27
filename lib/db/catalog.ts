import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { PAGE_SIZE, type SearchFilters } from "@/lib/search/filters";
import { supabase } from "./client";

// Listings change at most once per scheduled import, so short-lived caching is safe.

export interface ImageRef {
  ordinal: number;
  src: string;
  isFloorplan: boolean;
}

export interface PropertyCard {
  slug: string;
  listingType: "sale" | "rent";
  propertyType: string;
  city: string;
  region: string;
  priceEur: number;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaM2: number | null;
  hasPool: boolean;
  image: ImageRef | null;
}

export interface PropertyDetail extends PropertyCard {
  ref: string | null;
  locationDetail: string | null;
  plotAreaM2: number | null;
  isNewBuild: boolean;
  energyRating: string | null;
  features: string[];
  latitude: number | null;
  longitude: number | null;
  updatedAt: string;
  translations: Record<string, string>;
  images: ImageRef[];
}

interface ImageRow {
  ordinal: number;
  source_image_key: string;
  large_object_key: string | null;
  is_floorplan: boolean;
}

interface CardRow {
  slug: string;
  listing_type: "sale" | "rent";
  property_type: string;
  city: string;
  region: string;
  price_eur: number;
  bedrooms: number | null;
  bathrooms: number | null;
  living_area_m2: number | null;
  has_pool: boolean;
  property_images: ImageRow[];
}

const CARD_COLUMNS =
  "slug, listing_type, property_type, city, region, price_eur, bedrooms, bathrooms, living_area_m2, has_pool, " +
  "property_images(ordinal, source_image_key, large_object_key, is_floorplan)";

// Processed images are served from R2 once the image job has run; until then the feed URL.
const imageRef = (row: ImageRow): ImageRef => ({
  ordinal: row.ordinal,
  src: row.large_object_key && process.env.NEXT_PUBLIC_IMAGE_BASE_URL
    ? `${process.env.NEXT_PUBLIC_IMAGE_BASE_URL}/${row.large_object_key}`
    : row.source_image_key,
  isFloorplan: row.is_floorplan,
});

const toCard = (row: CardRow): PropertyCard => ({
  slug: row.slug,
  listingType: row.listing_type,
  propertyType: row.property_type,
  city: row.city,
  region: row.region,
  priceEur: row.price_eur,
  bedrooms: row.bedrooms,
  bathrooms: row.bathrooms,
  livingAreaM2: row.living_area_m2,
  hasPool: row.has_pool,
  image: row.property_images[0] ? imageRef(row.property_images[0]) : null,
});

export async function searchProperties(filters: SearchFilters): Promise<{ items: PropertyCard[]; total: number }> {
  "use cache";
  cacheLife("minutes");
  cacheTag("properties");

  let query = supabase
    .from("properties")
    .select(CARD_COLUMNS, { count: "exact" })
    .eq("listing_type", filters.listing);
  if (filters.region) query = query.eq("region", filters.region);
  if (filters.type) query = query.eq("property_type", filters.type);
  if (filters.minPrice !== undefined) query = query.gte("price_eur", filters.minPrice);
  if (filters.maxPrice !== undefined) query = query.lte("price_eur", filters.maxPrice);
  if (filters.minBeds !== undefined) query = query.gte("bedrooms", filters.minBeds);

  const from = (filters.page - 1) * PAGE_SIZE;
  const { data, error, count } = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .order("ordinal", { referencedTable: "property_images", ascending: true })
    .limit(1, { referencedTable: "property_images" })
    .range(from, from + PAGE_SIZE - 1);

  // PostgREST answers 416 when the page is past the end; treat it as an empty page.
  if (error && error.code !== "PGRST103") throw new Error(`searchProperties failed: ${error.message}`);
  return { items: ((data ?? []) as unknown as CardRow[]).map(toCard), total: count ?? 0 };
}

export async function getLatestProperties(limit: number): Promise<PropertyCard[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("properties");
  const { items } = await searchProperties({ listing: "sale", page: 1 });
  return items.slice(0, limit);
}

export interface Facets {
  regions: { name: string; count: number }[];
  types: string[];
  total: number;
}

export async function getFacets(): Promise<Facets> {
  "use cache";
  cacheLife("minutes");
  cacheTag("properties");

  const { data, error } = await supabase.from("property_facets").select("region, property_type, listing_count");
  if (error) throw new Error(`getFacets failed: ${error.message}`);
  const regions = new Map<string, number>();
  const types = new Set<string>();
  let total = 0;
  for (const row of data) {
    regions.set(row.region, (regions.get(row.region) ?? 0) + row.listing_count);
    types.add(row.property_type);
    total += row.listing_count;
  }
  return {
    regions: [...regions].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    types: [...types].sort(),
    total,
  };
}

export async function getProperty(slug: string): Promise<PropertyDetail | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("properties");

  const { data, error } = await supabase
    .from("properties")
    .select(
      `${CARD_COLUMNS}, ref, location_detail, plot_area_m2, is_new_build, energy_rating, features, latitude, longitude, updated_at, ` +
        "property_translations(locale, description)",
    )
    .eq("slug", slug)
    .order("ordinal", { referencedTable: "property_images", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`getProperty failed: ${error.message}`);
  if (!data) return null;

  const row = data as unknown as CardRow & {
    ref: string | null; location_detail: string | null; plot_area_m2: number | null; is_new_build: boolean;
    energy_rating: string | null; features: string[]; latitude: number | null; longitude: number | null;
    updated_at: string; property_translations: { locale: string; description: string }[];
  };
  return {
    ...toCard(row),
    ref: row.ref,
    locationDetail: row.location_detail,
    plotAreaM2: row.plot_area_m2,
    isNewBuild: row.is_new_build,
    energyRating: row.energy_rating,
    features: row.features,
    latitude: row.latitude,
    longitude: row.longitude,
    updatedAt: row.updated_at,
    translations: Object.fromEntries(row.property_translations.map((t) => [t.locale, t.description])),
    images: row.property_images.map(imageRef),
  };
}

export interface NearbyProperty {
  slug: string;
  city: string;
  listingType: "sale" | "rent";
  priceEur: number;
  distanceKm: number;
}

export async function getNearby(lat: number, lng: number, radiusKm: number, excludeSlug: string): Promise<NearbyProperty[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("properties");

  const { data, error } = await supabase.rpc("properties_near", { lat, lng, radius_km: radiusKm });
  if (error) throw new Error(`getNearby failed: ${error.message}`);
  return (data as { slug: string; city: string; listing_type: "sale" | "rent"; price_eur: number; distance_km: number }[])
    .filter((r) => r.slug !== excludeSlug)
    .slice(0, 6)
    .map((r) => ({ slug: r.slug, city: r.city, listingType: r.listing_type, priceEur: r.price_eur, distanceKm: r.distance_km }));
}

export interface ImportRun {
  id: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  feedRecordCount: number | null;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  removalPreview: number;
  deactivated: number;
  summary: string | null;
}

export async function getImportRuns(limit: number): Promise<ImportRun[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("import-runs");

  const { data, error } = await supabase
    .from("import_runs")
    .select(
      "id, status, started_at, finished_at, feed_record_count, inserted_count, updated_count, unchanged_count, " +
        "error_count, removal_preview_count, deactivated_count, error_summary",
    )
    .order("id", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getImportRuns failed: ${error.message}`);
  return (data as unknown as Record<string, never>[]).map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    feedRecordCount: r.feed_record_count,
    inserted: r.inserted_count,
    updated: r.updated_count,
    unchanged: r.unchanged_count,
    errors: r.error_count,
    removalPreview: r.removal_preview_count,
    deactivated: r.deactivated_count,
    summary: r.error_summary,
  }));
}
