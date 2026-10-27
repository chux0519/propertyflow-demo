// Contract between feed-specific adapters and the generic sync engine.
// Adapters parse, map and validate the source format; they never touch the database.

export type FeedMode = "full_snapshot" | "incremental";

export type ListingType = "sale" | "rent";

export interface NormalizedImage {
  ordinal: number;
  sourceUrl: string;
  isFloorplan: boolean;
}

export interface NormalizedProperty {
  externalId: string;
  sourceUpdatedAt: Date;
  ref: string | null;
  listingType: ListingType;
  propertyType: string;
  priceEur: number;
  city: string;
  region: string;
  locationDetail: string | null;
  location: { latitude: number; longitude: number } | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaM2: number | null;
  plotAreaM2: number | null;
  hasPool: boolean;
  isNewBuild: boolean;
  energyRating: string | null;
  features: string[];
  /** Only locales the catalogue supports; missing locales are left out, never invented. */
  translations: Partial<Record<SupportedLocale, string>>;
  images: NormalizedImage[];
}

export const SUPPORTED_LOCALES = ["en", "de"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** A problem with one record; the rest of the feed can still be imported. */
export interface RecordError {
  externalId: string | null;
  code: string;
  message: string;
}

/** A problem with the feed as a whole; nothing from this feed may be written. */
export class FeedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FeedError";
    this.code = code;
  }
}

export type AdapterItem =
  | { ok: true; record: NormalizedProperty }
  | { ok: false; error: RecordError };

export interface FeedSemantics {
  adapterType: string;
  feedMode: FeedMode;
}

export interface FeedAdapter {
  getFeedSemantics(): FeedSemantics;
  /**
   * Streams records from the feed. Envelope problems (wrong root, wrong version,
   * DTD, truncation, malformed XML) throw FeedError; per-record problems are yielded.
   */
  streamProperties(input: NodeJS.ReadableStream): AsyncIterable<AdapterItem>;
}
