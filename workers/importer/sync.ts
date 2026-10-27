// Generic, adapter-agnostic sync: checksum → parse/validate (no writes) → one
// transaction for upserts → guarded soft-deactivation → run bookkeeping.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { Client } from "pg";
import { FeedError, type FeedAdapter, type NormalizedProperty, type RecordError } from "./adapters/types.ts";

export interface SyncOptions {
  adapter: FeedAdapter;
  filePath: string;
  sourceName: string;
  /** Run everything inside a transaction that is rolled back; nothing persists. */
  dryRun?: boolean;
  /** Soft-deactivate listings missing from a full snapshot (still subject to guards). */
  allowDeactivate?: boolean;
  /** Max tolerated drop in record count vs. the last completed run before deactivation is refused. */
  dropThreshold?: number;
  /** Max share of invalid records before the whole feed is rejected. */
  maxErrorRatio?: number;
  maxBytes?: number;
  log?: (message: string) => void;
}

export interface SyncSummary {
  runId: number | null;
  status: "COMPLETED" | "FAILED";
  dryRun: boolean;
  source: string;
  adapter: string;
  feedChecksum: string | null;
  feedRecordCount: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: number;
  removalPreview: number;
  deactivated: number;
  deactivation: "disabled" | "applied" | "refused" | "not_applicable";
  message: string | null;
  durationMs: number;
}

export class ConcurrentRunError extends Error {
  constructor(source: string) {
    super(`Another import for source "${source}" is already running`);
    this.name = "ConcurrentRunError";
  }
}

const BATCH_SIZE = 250;
const MAX_STORED_ERRORS = 200;

export function hashProperty(p: NormalizedProperty): string {
  // sourceUpdatedAt is deliberately excluded: changes are detected from content, not the feed's <date>.
  const canonical = {
    externalId: p.externalId, ref: p.ref, listingType: p.listingType, propertyType: p.propertyType,
    priceEur: p.priceEur, city: p.city, region: p.region, locationDetail: p.locationDetail,
    location: p.location, bedrooms: p.bedrooms, bathrooms: p.bathrooms, livingAreaM2: p.livingAreaM2,
    plotAreaM2: p.plotAreaM2, hasPool: p.hasPool, isNewBuild: p.isNewBuild, energyRating: p.energyRating,
    features: p.features,
    translations: Object.entries(p.translations).sort(([a], [b]) => a.localeCompare(b)),
    images: p.images,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function slugify(...parts: string[]): string {
  return parts
    .join(" ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
}

async function fileChecksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

const lockKey = (source: string) => `propertyflow-import:${source}`;

export async function runSync(db: Client, opts: SyncOptions): Promise<SyncSummary> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const dryRun = opts.dryRun ?? false;
  const dropThreshold = opts.dropThreshold ?? 0.2;
  const maxErrorRatio = opts.maxErrorRatio ?? 0.1;
  const maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
  const { adapterType, feedMode } = opts.adapter.getFeedSemantics();

  const summary: SyncSummary = {
    runId: null, status: "FAILED", dryRun, source: opts.sourceName, adapter: adapterType,
    feedChecksum: null, feedRecordCount: 0, inserted: 0, updated: 0, unchanged: 0, errors: 0,
    removalPreview: 0, deactivated: 0, deactivation: opts.allowDeactivate ? "not_applicable" : "disabled",
    message: null, durationMs: 0,
  };
  const recordErrors: RecordError[] = [];

  const { rows: lockRows } = await db.query<{ locked: boolean }>(
    "select pg_try_advisory_lock(hashtext($1)) as locked", [lockKey(opts.sourceName)],
  );
  if (!lockRows[0].locked) throw new ConcurrentRunError(opts.sourceName);

  let inTx = false;
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    if (summary.runId === null) return;
    const cols = Object.keys(extra);
    await db.query(
      `update public.import_runs set status = $2${cols.map((c, i) => `, ${c} = $${i + 3}`).join("")} where id = $1`,
      [summary.runId, status, ...Object.values(extra)],
    );
    log(`run ${summary.runId}: ${status}`);
  };

  try {
    // A dry run wraps everything, including bookkeeping, in one rolled-back transaction.
    if (dryRun) {
      await db.query("begin");
      inTx = true;
    }

    const { rows: srcRows } = await db.query<{ id: number }>(
      `insert into public.sources (name, adapter_type, feed_mode) values ($1, $2, $3)
       on conflict (name) do update set adapter_type = excluded.adapter_type, feed_mode = excluded.feed_mode
       returning id`,
      [opts.sourceName, adapterType, feedMode],
    );
    const sourceId = srcRows[0].id;

    const { rows: runRows } = await db.query<{ id: string }>(
      "insert into public.import_runs (source_id, adapter_type) values ($1, $2) returning id",
      [sourceId, adapterType],
    );
    summary.runId = Number(runRows[0].id);

    // FETCHED: size limit + checksum before any parsing.
    const { size } = await stat(opts.filePath);
    if (size > maxBytes) throw new FeedError("FEED_TOO_LARGE", `Feed is ${size} bytes; limit is ${maxBytes}`);
    summary.feedChecksum = await fileChecksum(opts.filePath);
    await setStatus("FETCHED", { feed_checksum: summary.feedChecksum, feed_bytes: size });

    // PARSED: stream the whole feed before writing anything, so a truncated or
    // malformed file fails here with the existing data untouched.
    const records = new Map<string, NormalizedProperty>();
    for await (const item of opts.adapter.streamProperties(createReadStream(opts.filePath))) {
      summary.feedRecordCount += 1;
      if (!item.ok) {
        recordErrors.push(item.error);
      } else if (records.has(item.record.externalId)) {
        recordErrors.push({ externalId: item.record.externalId, code: "DUPLICATE_ID", message: "Duplicate <id> in feed; first occurrence kept" });
      } else {
        records.set(item.record.externalId, item.record);
      }
    }
    summary.errors = recordErrors.length;
    await setStatus("PARSED", { feed_record_count: summary.feedRecordCount, error_count: summary.errors });

    // VALIDATED: feed-level sanity.
    const errorRatio = summary.errors / summary.feedRecordCount;
    if (errorRatio > maxErrorRatio) {
      throw new FeedError(
        "TOO_MANY_RECORD_ERRORS",
        `${summary.errors} of ${summary.feedRecordCount} records invalid (limit ${Math.round(maxErrorRatio * 100)}%)`,
      );
    }
    await setStatus("VALIDATED");

    // IMPORTING: one transaction for all business writes.
    await setStatus("IMPORTING");
    if (!inTx) {
      await db.query("begin");
      inTx = true;
    }

    const all = [...records.values()];
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const batch = all.slice(i, i + BATCH_SIZE);
      const { inserted, updated } = await upsertBatch(db, sourceId, summary.runId, batch);
      summary.inserted += inserted;
      summary.updated += updated;
    }
    summary.unchanged = all.length - summary.inserted - summary.updated;

    // Removal candidates: active listings of this source not seen in this snapshot.
    // Records that failed validation still exist in the feed and are never candidates.
    const presentIds = [...records.keys(), ...recordErrors.flatMap((e) => (e.externalId ? [e.externalId] : []))];
    const candidateSql = `from public.properties where source_id = $1 and status = 'active'
      and last_seen_run_id is distinct from $2 and not (external_id = any($3::text[]))`;
    const { rows: previewRows } = await db.query<{ n: string }>(
      `select count(*) as n ${candidateSql}`, [sourceId, summary.runId, presentIds],
    );
    summary.removalPreview = Number(previewRows[0].n);

    if (opts.allowDeactivate && summary.removalPreview > 0) {
      const refusal = await deactivationRefusal(db, {
        feedMode, sourceId, runId: summary.runId, feedRecordCount: summary.feedRecordCount,
        dropThreshold, idlessErrors: recordErrors.some((e) => !e.externalId),
      });
      if (refusal) {
        summary.deactivation = "refused";
        summary.message = `Deactivation refused: ${refusal}`;
      } else {
        const { rowCount } = await db.query(
          `update public.properties set status = 'inactive', updated_at = now() where id in (select id ${candidateSql})`,
          [sourceId, summary.runId, presentIds],
        );
        summary.deactivated = rowCount ?? 0;
        summary.deactivation = "applied";
      }
    }

    if (!dryRun) {
      await db.query("commit");
      inTx = false;
    }

    summary.status = "COMPLETED";
    await setStatus("COMPLETED", {
      finished_at: new Date(), inserted_count: summary.inserted, updated_count: summary.updated,
      unchanged_count: summary.unchanged, removal_preview_count: summary.removalPreview,
      deactivated_count: summary.deactivated, error_summary: summary.message ?? errorDigest(recordErrors),
    });
    await storeRecordErrors(db, summary.runId, recordErrors);
  } catch (err) {
    if (inTx && !dryRun) {
      await db.query("rollback");
      inTx = false;
    }
    summary.status = "FAILED";
    summary.inserted = summary.updated = summary.unchanged = summary.deactivated = 0;
    // Only FeedError messages are written for the public status page; anything else
    // (e.g. a database error) is logged locally and summarised generically.
    summary.message = err instanceof FeedError ? `${err.code}: ${err.message}` : "Internal error (see importer logs)";
    if (!(err instanceof FeedError)) log(`unexpected error: ${(err as Error).stack ?? err}`);
    if (!dryRun) {
      await setStatus("FAILED", { finished_at: new Date(), error_summary: summary.message, error_count: summary.errors });
      await storeRecordErrors(db, summary.runId, recordErrors);
    }
  } finally {
    if (dryRun && inTx) await db.query("rollback");
    await db.query("select pg_advisory_unlock(hashtext($1))", [lockKey(opts.sourceName)]);
  }

  summary.durationMs = Date.now() - started;
  return summary;
}

async function deactivationRefusal(
  db: Client,
  ctx: { feedMode: string; sourceId: number; runId: number; feedRecordCount: number; dropThreshold: number; idlessErrors: boolean },
): Promise<string | null> {
  if (ctx.feedMode !== "full_snapshot") return "feed is not a full snapshot";
  if (ctx.idlessErrors) return "feed contains records without a usable <id>";
  const { rows } = await db.query<{ feed_record_count: number }>(
    `select feed_record_count from public.import_runs
     where source_id = $1 and status = 'COMPLETED' and id <> $2 order by id desc limit 1`,
    [ctx.sourceId, ctx.runId],
  );
  if (rows.length === 0) return "no previous completed run to compare against";
  const previous = rows[0].feed_record_count;
  if (previous > 0 && ctx.feedRecordCount < previous * (1 - ctx.dropThreshold)) {
    const drop = Math.round((1 - ctx.feedRecordCount / previous) * 100);
    return `record count dropped ${drop}% (${previous} → ${ctx.feedRecordCount}), threshold ${Math.round(ctx.dropThreshold * 100)}%`;
  }
  return null;
}

function errorDigest(errors: RecordError[]): string | null {
  if (errors.length === 0) return null;
  const byCode = new Map<string, number>();
  for (const e of errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
  return `${errors.length} record(s) skipped: ` + [...byCode].map(([code, n]) => `${code}×${n}`).join(", ");
}

async function storeRecordErrors(db: Client, runId: number | null, errors: RecordError[]) {
  if (runId === null || errors.length === 0) return;
  const rows = errors.slice(0, MAX_STORED_ERRORS);
  await db.query(
    `insert into public.import_errors (run_id, external_id, error_code, safe_message)
     select $1, r.external_id, r.code, r.message from jsonb_to_recordset($2::jsonb) as r(external_id text, code text, message text)`,
    [runId, JSON.stringify(rows.map((e) => ({ external_id: e.externalId, code: e.code, message: e.message })))],
  );
}

async function upsertBatch(db: Client, sourceId: number, runId: number, batch: NormalizedProperty[]) {
  const payload = batch.map((p) => ({
    external_id: p.externalId,
    slug: slugify(p.propertyType, p.city, p.externalId),
    ref: p.ref,
    listing_type: p.listingType,
    property_type: p.propertyType,
    region: p.region,
    city: p.city,
    location_detail: p.locationDetail,
    price_eur: p.priceEur,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    living_area_m2: p.livingAreaM2,
    plot_area_m2: p.plotAreaM2,
    has_pool: p.hasPool,
    is_new_build: p.isNewBuild,
    energy_rating: p.energyRating,
    features: p.features,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    normalized_hash: hashProperty(p),
    source_updated_at: p.sourceUpdatedAt.toISOString(),
  }));

  // Only rows whose content hash changed (or that were inactive) are rewritten.
  // Unchanged rows are not returned; xmax = 0 identifies freshly inserted rows.
  const { rows: changed } = await db.query<{ id: string; external_id: string; inserted: boolean }>(
    `insert into public.properties as p (
       source_id, external_id, slug, ref, listing_type, property_type, region, city, location_detail,
       price_eur, bedrooms, bathrooms, living_area_m2, plot_area_m2, has_pool, is_new_build, energy_rating,
       features, latitude, longitude, geom, normalized_hash, source_updated_at, last_seen_run_id)
     select $1, r.external_id, r.slug, r.ref, r.listing_type, r.property_type, r.region, r.city, r.location_detail,
       r.price_eur, r.bedrooms, r.bathrooms, r.living_area_m2, r.plot_area_m2, r.has_pool, r.is_new_build,
       r.energy_rating, r.features, r.latitude, r.longitude,
       case when r.latitude is null then null
            else extensions.st_point(r.longitude, r.latitude, 4326)::extensions.geography end,
       r.normalized_hash, r.source_updated_at, $2
     from jsonb_to_recordset($3::jsonb) as r(
       external_id text, slug text, ref text, listing_type text, property_type text, region text, city text,
       location_detail text, price_eur integer, bedrooms smallint, bathrooms smallint, living_area_m2 integer,
       plot_area_m2 integer, has_pool boolean, is_new_build boolean, energy_rating text, features text[],
       latitude double precision, longitude double precision, normalized_hash text, source_updated_at timestamptz)
     on conflict (source_id, external_id) do update set
       ref = excluded.ref, listing_type = excluded.listing_type, property_type = excluded.property_type,
       region = excluded.region, city = excluded.city, location_detail = excluded.location_detail,
       price_eur = excluded.price_eur, bedrooms = excluded.bedrooms, bathrooms = excluded.bathrooms,
       living_area_m2 = excluded.living_area_m2, plot_area_m2 = excluded.plot_area_m2,
       has_pool = excluded.has_pool, is_new_build = excluded.is_new_build, energy_rating = excluded.energy_rating,
       features = excluded.features, latitude = excluded.latitude, longitude = excluded.longitude,
       geom = excluded.geom, normalized_hash = excluded.normalized_hash,
       source_updated_at = excluded.source_updated_at, last_seen_run_id = excluded.last_seen_run_id,
       status = 'active', updated_at = now()
     where p.normalized_hash is distinct from excluded.normalized_hash or p.status <> 'active'
     returning p.id, p.external_id, (p.xmax = 0) as inserted`,
    [sourceId, runId, JSON.stringify(payload)],
  );

  // Unchanged rows still count as seen in this snapshot.
  await db.query(
    `update public.properties set last_seen_run_id = $2
     where source_id = $1 and external_id = any($3::text[]) and last_seen_run_id is distinct from $2`,
    [sourceId, runId, batch.map((p) => p.externalId)],
  );

  if (changed.length > 0) {
    const byExternal = new Map(batch.map((p) => [p.externalId, p]));
    const ids = changed.map((c) => c.id);
    await db.query("delete from public.property_translations where property_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.property_images where property_id = any($1::uuid[])", [ids]);

    const translations = changed.flatMap((c) =>
      Object.entries(byExternal.get(c.external_id)!.translations).map(([locale, description]) => ({ property_id: c.id, locale, description })),
    );
    const images = changed.flatMap((c) =>
      byExternal.get(c.external_id)!.images.map((img) => ({
        property_id: c.id, ordinal: img.ordinal, source_image_key: img.sourceUrl, is_floorplan: img.isFloorplan,
      })),
    );
    await db.query(
      `insert into public.property_translations (property_id, locale, description)
       select r.property_id, r.locale, r.description
       from jsonb_to_recordset($1::jsonb) as r(property_id uuid, locale text, description text)`,
      [JSON.stringify(translations)],
    );
    await db.query(
      `insert into public.property_images (property_id, ordinal, source_image_key, is_floorplan)
       select r.property_id, r.ordinal, r.source_image_key, r.is_floorplan
       from jsonb_to_recordset($1::jsonb) as r(property_id uuid, ordinal smallint, source_image_key text, is_floorplan boolean)`,
      [JSON.stringify(images)],
    );
  }

  const inserted = changed.filter((c) => c.inserted).length;
  return { inserted, updated: changed.length - inserted };
}
