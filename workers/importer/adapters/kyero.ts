// Kyero V3 import feed adapter (reference: Kyero XML Import Specification V3.9.1).
// Streams the XML with saxes, which never fetches external resources; any DOCTYPE is
// rejected outright so DTD/entity tricks (XXE, billion laughs) cannot reach us.

import { SaxesParser, type SaxesTagPlain } from "saxes";
import {
  FeedError,
  SUPPORTED_LOCALES,
  type AdapterItem,
  type FeedAdapter,
  type FeedSemantics,
  type NormalizedImage,
  type NormalizedProperty,
  type RecordError,
} from "./types.ts";

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const MAX_TEXT_CHARS = 20_000;
const MAX_IMAGES = 50;
const MAX_FEATURES = 40;

class RecordInvalid extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class KyeroAdapter implements FeedAdapter {
  getFeedSemantics(): FeedSemantics {
    // Kyero feeds carry the publisher's complete listing set on every fetch.
    return { adapterType: "kyero", feedMode: "full_snapshot" };
  }

  async *streamProperties(input: NodeJS.ReadableStream): AsyncIterable<AdapterItem> {
    const parser = new SaxesParser<{ xmlns: false; position: true }>({ xmlns: false, position: true });
    const queue: AdapterItem[] = [];
    const stack: XNode[] = [];
    let parseError: FeedError | null = null;
    let sawRoot = false;
    let feedVersion: string | null = null;
    let propertyCount = 0;

    const fail = (code: string, message: string) => {
      parseError ??= new FeedError(code, message);
    };

    parser.on("doctype", () => fail("DOCTYPE_FORBIDDEN", "DOCTYPE declarations are not accepted"));
    parser.on("error", (err) => fail("MALFORMED_XML", `XML is not well-formed: ${err.message}`));

    parser.on("opentag", (tag: SaxesTagPlain) => {
      if (parseError) return;
      const depth = stack.length;
      if (depth === 0) {
        if (tag.name !== "root") return fail("BAD_ENVELOPE", `Expected <root>, found <${tag.name}>`);
        sawRoot = true;
      }
      if (depth === 1 && tag.name === "property") {
        if (feedVersion !== "3") {
          return fail("BAD_ENVELOPE", "Missing <kyero><feed_version>3</feed_version></kyero> before properties");
        }
      }
      stack.push({ name: tag.name, attrs: { ...tag.attributes }, children: [], text: "" });
    });

    const onText = (text: string) => {
      if (parseError) return;
      const node = stack.at(-1);
      if (!node) return;
      if (node.text.length + text.length > MAX_TEXT_CHARS) {
        return fail("TEXT_TOO_LARGE", `Text in <${node.name}> exceeds ${MAX_TEXT_CHARS} characters`);
      }
      node.text += text;
    };
    parser.on("text", onText);
    parser.on("cdata", onText);

    parser.on("closetag", () => {
      if (parseError) return;
      const node = stack.pop();
      if (!node) return;
      const parent = stack.at(-1);
      const depth = stack.length;
      if (depth === 2 && parent?.name === "kyero" && node.name === "feed_version") {
        feedVersion = node.text.trim();
        if (feedVersion !== "3") fail("UNSUPPORTED_VERSION", `Unsupported Kyero feed_version "${feedVersion}"`);
        return;
      }
      if (depth === 1 && node.name === "property") {
        propertyCount += 1;
        queue.push(normalizeKyeroProperty(node));
        return; // do not keep finished properties in memory
      }
      if (depth >= 2) parent?.children.push(node);
    });

    for await (const chunk of input) {
      parser.write(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      if (parseError) throw parseError;
      while (queue.length) yield queue.shift()!;
    }
    parser.close();
    if (parseError) throw parseError;
    if (!sawRoot) throw new FeedError("BAD_ENVELOPE", "Feed is empty");
    if (feedVersion !== "3") throw new FeedError("BAD_ENVELOPE", "Missing Kyero feed_version header");
    while (queue.length) yield queue.shift()!;
    if (propertyCount === 0) throw new FeedError("EMPTY_FEED", "Feed contains no <property> elements");
  }
}

// ---------------------------------------------------------------------------
// Record normalisation
// ---------------------------------------------------------------------------

const child = (node: XNode | undefined, name: string) => node?.children.find((c) => c.name === name);
const children = (node: XNode | undefined, name: string) => node?.children.filter((c) => c.name === name) ?? [];
const text = (node: XNode | undefined, name: string) => cleanText(child(node, name)?.text ?? "");

/** Feed text is untrusted: drop control characters, honour &#13; line breaks, trim. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function required(node: XNode, name: string): string {
  const value = text(node, name);
  if (!value) throw new RecordInvalid("MISSING_FIELD", `Missing required <${name}>`);
  return value;
}

function optionalInt(value: string, field: string, max: number): number | null {
  if (value === "" || value === "0") return null; // Kyero: empty or 0 means unknown
  if (!/^\d+$/.test(value)) throw new RecordInvalid("INVALID_NUMBER", `<${field}> must be a whole number`);
  const n = Number(value);
  if (n > max) throw new RecordInvalid("INVALID_NUMBER", `<${field}> is out of range`);
  return n;
}

const flag = (value: string) => value === "1";

/** Kyero dates are `YYYY-MM-DD HH:MM:SS` without zone; interpreted as UTC. */
export function parseKyeroDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new RecordInvalid("INVALID_DATE", "<date> must be YYYY-MM-DD HH:MM:SS");
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (
    date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d ||
    h > 23 || mi > 59 || s > 59
  ) {
    throw new RecordInvalid("INVALID_DATE", "<date> is not a real calendar date");
  }
  return date;
}

const titleCase = (s: string) =>
  s.toLocaleLowerCase("es").replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase("es"));

function parseLocation(node: XNode): NormalizedProperty["location"] {
  const loc = child(node, "location");
  const latRaw = text(loc, "latitude");
  const lngRaw = text(loc, "longitude");
  const empty = (v: string) => v === "" || Number(v) === 0;
  if (empty(latRaw) || empty(lngRaw)) return null;
  const latitude = Number(latRaw);
  const longitude = Number(lngRaw);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new RecordInvalid("INVALID_LOCATION", "<location> coordinates are invalid");
  }
  return { latitude, longitude };
}

function parseImages(node: XNode): NormalizedImage[] {
  const seen = new Set<number>();
  const images: NormalizedImage[] = [];
  for (const img of children(child(node, "images"), "image")) {
    const ordinal = Number(img.attrs.id);
    const url = text(img, "url");
    // A bad image entry is dropped rather than rejecting the whole listing.
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_IMAGES || seen.has(ordinal)) continue;
    if (url.length > 2048 || !/^https?:\/\/[^\s]+$/i.test(url)) continue;
    seen.add(ordinal);
    const tags = children(child(img, "tags"), "tag").map((t) => cleanText(t.text).toLowerCase());
    images.push({ ordinal, sourceUrl: url, isFloorplan: tags.includes("floorplan") });
  }
  return images.sort((a, b) => a.ordinal - b.ordinal);
}

export function normalizeKyeroProperty(node: XNode): AdapterItem {
  const rawId = text(node, "id");
  try {
    if (!rawId) throw new RecordInvalid("MISSING_FIELD", "Missing required <id>");
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,49}$/.test(rawId)) {
      throw new RecordInvalid("INVALID_ID", "<id> must be 1-50 alphanumeric characters");
    }
    const sourceUpdatedAt = parseKyeroDate(required(node, "date"));

    const priceRaw = required(node, "price");
    if (!/^\d{1,8}$/.test(priceRaw)) throw new RecordInvalid("INVALID_PRICE", "<price> must be a whole number");

    // Kyero defines an empty/missing currency as EUR. Other currencies need a
    // verifiable conversion rule we do not have, so they are rejected.
    const currency = text(node, "currency").toUpperCase();
    if (currency !== "" && currency !== "EUR") {
      throw new RecordInvalid("UNSUPPORTED_CURRENCY", `Currency ${currency.slice(0, 3)} is not supported`);
    }

    const priceFreq = required(node, "price_freq").toLowerCase();
    if (priceFreq !== "sale" && priceFreq !== "month") {
      throw new RecordInvalid("INVALID_PRICE_FREQ", "<price_freq> must be 'sale' or 'month'");
    }

    const propertyType = required(node, "type").toLowerCase().replace(/\s+/g, " ");
    if (propertyType.length > 50) throw new RecordInvalid("INVALID_TYPE", "<type> is too long");

    const desc = child(node, "desc");
    const translations: NormalizedProperty["translations"] = {};
    for (const locale of SUPPORTED_LOCALES) {
      const value = text(desc, locale);
      if (value) translations[locale] = value;
    }
    const anyDesc = (desc?.children ?? []).some((c) => cleanText(c.text) !== "");
    const features = children(child(node, "features"), "feature")
      .map((f) => cleanText(f.text).toLowerCase())
      .filter((f) => f !== "" && f.length <= 35)
      .slice(0, MAX_FEATURES);
    if (!anyDesc && features.length === 0) {
      throw new RecordInvalid("MISSING_FIELD", "<desc> is required when there are no <features>");
    }

    const energy = text(child(node, "energy_rating"), "consumption").toUpperCase();
    const area = child(node, "surface_area");
    const record: NormalizedProperty = {
      externalId: rawId,
      sourceUpdatedAt,
      ref: text(node, "ref").slice(0, 255) || null,
      listingType: priceFreq === "sale" ? "sale" : "rent",
      propertyType,
      priceEur: Number(priceRaw),
      city: titleCase(required(node, "town")).slice(0, 100),
      region: titleCase(required(node, "province")).slice(0, 100),
      locationDetail: text(node, "location_detail").slice(0, 50) || null,
      location: parseLocation(node),
      bedrooms: optionalInt(text(node, "beds"), "beds", 99),
      bathrooms: optionalInt(text(node, "baths"), "baths", 99),
      livingAreaM2: optionalInt(text(area, "built"), "built", 100_000),
      plotAreaM2: optionalInt(text(area, "plot"), "plot", 10_000_000),
      hasPool: flag(text(node, "pool")),
      isNewBuild: flag(text(node, "new_build")),
      energyRating: /^[A-G]$/.test(energy) ? energy : null,
      features,
      translations,
      images: parseImages(node),
    };
    return { ok: true, record };
  } catch (err) {
    if (err instanceof RecordInvalid) {
      const error: RecordError = { externalId: rawId ? rawId.slice(0, 50) : null, code: err.code, message: err.message };
      return { ok: false, error };
    }
    throw err;
  }
}
