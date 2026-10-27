// Runs against a disposable local database (`supabase start`):
//   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test
// Skipped when TEST_DATABASE_URL is not set.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KyeroAdapter } from "../workers/importer/adapters/kyero.ts";
import { ConcurrentRunError, runSync, type SyncOptions } from "../workers/importer/sync.ts";
import { generateKyeroFeed, listingId, type FeedOptions } from "../scripts/kyero-fixture.ts";

const url = process.env.TEST_DATABASE_URL;
const COUNT = 40;
const SOURCE = "test-kyero";

describe.skipIf(!url)("sync against PostgreSQL", () => {
  let db: pg.Client;
  const dir = mkdtempSync(join(tmpdir(), "propertyflow-"));
  let fileNo = 0;

  const feedFile = (opts: Partial<FeedOptions> = {}, transform = (xml: string) => xml) => {
    const path = join(dir, `feed-${++fileNo}.xml`);
    writeFileSync(path, transform(generateKyeroFeed({ count: COUNT, ...opts })));
    return path;
  };
  const sync = (filePath: string, opts: Partial<SyncOptions> = {}) =>
    runSync(db, { adapter: new KyeroAdapter(), sourceName: SOURCE, filePath, ...opts });
  const scalar = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);
  const activeCount = () => scalar("select count(*) as n from public.properties where status = 'active'");

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
  });
  afterAll(async () => {
    await db?.end();
  });
  beforeEach(async () => {
    await db.query("truncate public.import_errors, public.property_images, public.property_translations, public.properties, public.import_runs, public.sources restart identity cascade");
  });

  it("is idempotent: re-running the same feed changes nothing", async () => {
    const file = feedFile();
    const first = await sync(file);
    expect(first).toMatchObject({ status: "COMPLETED", inserted: COUNT, updated: 0, unchanged: 0, errors: 0 });

    const second = await sync(file);
    expect(second).toMatchObject({ status: "COMPLETED", inserted: 0, updated: 0, unchanged: COUNT });
    expect(await scalar("select count(*) as n from public.properties")).toBe(COUNT);
    expect(await scalar("select count(distinct last_seen_run_id) as n from public.properties")).toBe(1);
    expect(await scalar("select max(last_seen_run_id) as n from public.properties")).toBe(second.runId);
  });

  it("updates exactly one row when one price changes", async () => {
    await sync(feedFile());
    const id = listingId(7);
    const changed = feedFile({}, (xml) => xml.replace(new RegExp(`(<id>${id}</id>[\\s\\S]*?<price>)(\\d+)`), "$1123456"));
    const result = await sync(changed);
    expect(result).toMatchObject({ inserted: 0, updated: 1, unchanged: COUNT - 1 });
    expect(await scalar("select price_eur as n from public.properties where external_id = $1", [id])).toBe(123456);
  });

  it("ignores a changed <date> when the content is identical", async () => {
    await sync(feedFile());
    const redated = feedFile({}, (xml) => xml.replace(/<date>[^<]+<\/date>/g, "<date>2030-01-01 00:00:00</date>"));
    expect(await sync(redated)).toMatchObject({ updated: 0, unchanged: COUNT });
  });

  it("fails a truncated feed without touching existing data", async () => {
    await sync(feedFile());
    const truncated = feedFile({}, (xml) => xml.slice(0, Math.floor(xml.length / 2)));
    const result = await sync(truncated, { allowDeactivate: true });
    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/^MALFORMED_XML/);
    expect(await activeCount()).toBe(COUNT);
    const run = await db.query("select status, error_summary from public.import_runs where id = $1", [result.runId]);
    expect(run.rows[0]).toMatchObject({ status: "FAILED" });
  });

  it("keeps the first of duplicate ids and reports the duplicate", async () => {
    const dup = feedFile({}, (xml) => {
      const block = xml.slice(xml.indexOf("<property>"), xml.indexOf("</property>") + "</property>".length);
      return xml.replace("</root>", `${block}\n</root>`);
    });
    const result = await sync(dup);
    expect(result).toMatchObject({ status: "COMPLETED", inserted: COUNT, errors: 1 });
    expect(await scalar("select count(*) as n from public.import_errors where error_code = 'DUPLICATE_ID'")).toBe(1);
  });

  it("rejects the whole feed when too many records are invalid", async () => {
    await sync(feedFile());
    const dirty = feedFile({}, (xml) => xml.replace(/<price_freq>sale<\/price_freq>/g, "<price_freq>weekly</price_freq>"));
    const result = await sync(dirty);
    expect(result.status).toBe("FAILED");
    expect(result.message).toMatch(/^TOO_MANY_RECORD_ERRORS/);
    expect(await activeCount()).toBe(COUNT);
  });

  it("never deactivates missing listings by default", async () => {
    await sync(feedFile());
    const half = feedFile({ omit: new Set(Array.from({ length: COUNT / 2 }, (_, i) => i + 1)) });
    const result = await sync(half);
    expect(result).toMatchObject({ status: "COMPLETED", removalPreview: COUNT / 2, deactivated: 0, deactivation: "disabled" });
    expect(await activeCount()).toBe(COUNT);
  });

  it("refuses deactivation after a suspicious drop even when enabled", async () => {
    await sync(feedFile());
    const half = feedFile({ omit: new Set(Array.from({ length: COUNT / 2 }, (_, i) => i + 1)) });
    const result = await sync(half, { allowDeactivate: true });
    expect(result).toMatchObject({ status: "COMPLETED", deactivation: "refused", deactivated: 0 });
    expect(result.message).toMatch(/dropped 50%/);
    expect(await activeCount()).toBe(COUNT);
  });

  it("soft-deactivates a small, plausible removal when enabled, and reactivates on return", async () => {
    await sync(feedFile());
    const result = await sync(feedFile({ omit: new Set([3, 4]) }), { allowDeactivate: true });
    expect(result).toMatchObject({ deactivation: "applied", deactivated: 2, removalPreview: 2 });
    expect(await activeCount()).toBe(COUNT - 2);
    expect(await scalar("select count(*) as n from public.properties")).toBe(COUNT); // no physical delete

    const back = await sync(feedFile());
    expect(back).toMatchObject({ inserted: 0, updated: 2, unchanged: COUNT - 2 });
    expect(await activeCount()).toBe(COUNT);
  });

  it("does not deactivate a listing that is present but invalid", async () => {
    await sync(feedFile());
    const id = listingId(5);
    const broken = feedFile({}, (xml) => xml.replace(new RegExp(`(<id>${id}</id>\\s*<date>)[^<]+`), "$1yesterday"));
    const result = await sync(broken, { allowDeactivate: true });
    expect(result).toMatchObject({ errors: 1, removalPreview: 0, deactivated: 0 });
    expect(await activeCount()).toBe(COUNT);
  });

  it("dry run writes nothing", async () => {
    const result = await sync(feedFile(), { dryRun: true });
    expect(result).toMatchObject({ status: "COMPLETED", dryRun: true, inserted: COUNT });
    expect(await scalar("select count(*) as n from public.properties")).toBe(0);
    expect(await scalar("select count(*) as n from public.import_runs")).toBe(0);
  });

  it("refuses to run concurrently for the same source", async () => {
    const other = new pg.Client({ connectionString: url });
    await other.connect();
    try {
      await other.query("select pg_advisory_lock(hashtext($1))", [`propertyflow-import:${SOURCE}`]);
      await expect(sync(feedFile())).rejects.toBeInstanceOf(ConcurrentRunError);
      expect(await scalar("select count(*) as n from public.import_runs")).toBe(0);
    } finally {
      await other.end();
    }
  });

  it("exposes only active listings and safe run columns to the anon role", async () => {
    await sync(feedFile());
    await sync(feedFile({ omit: new Set([1]) }), { allowDeactivate: true });
    await db.query("begin; set local role anon");
    try {
      expect(await scalar("select count(*) as n from public.properties")).toBe(COUNT - 1);
      expect(await scalar("select count(*) as n from public.property_translations")).toBeGreaterThan(0);
      expect(await scalar("select count(*) as n from public.properties_near(38.79, 0.166, 30)")).toBeGreaterThanOrEqual(0);
      await expect(db.query("select feed_checksum from public.import_runs")).rejects.toThrow(/permission denied/);
    } finally {
      await db.query("rollback");
    }
    for (const sql of ["select * from public.import_errors", "delete from public.properties", "insert into public.sources (name, adapter_type, feed_mode) values ('x1', 'k', 'incremental')"]) {
      await db.query("begin; set local role anon");
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
      await db.query("rollback");
    }
  });

  it("answers the spatial radius query", async () => {
    await sync(feedFile({ count: 200 }));
    const { rows } = await db.query("select * from public.properties_near(38.789, 0.166, 15)");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.distance_km <= 15)).toBe(true);
  });
});
