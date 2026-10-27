import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { KyeroAdapter, cleanText, parseKyeroDate } from "../workers/importer/adapters/kyero.ts";
import { FeedError, type AdapterItem } from "../workers/importer/adapters/types.ts";
import { generateKyeroFeed } from "../scripts/kyero-fixture.ts";

async function collect(xml: string | NodeJS.ReadableStream): Promise<AdapterItem[]> {
  const stream = typeof xml === "string" ? Readable.from([xml]) : xml;
  const items: AdapterItem[] = [];
  for await (const item of new KyeroAdapter().streamProperties(stream)) items.push(item);
  return items;
}

const wrap = (property: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><root><kyero><feed_version>3</feed_version></kyero>${property}</root>`;

const minimal = (extra = "", overrides: Record<string, string> = {}) => {
  const f = {
    id: "A1", date: "2026-10-01 12:00:00", price: "250000", price_freq: "sale", type: "Villa",
    town: "jávea", province: "alicante", ...overrides,
  };
  const tags = Object.entries(f).map(([k, v]) => `<${k}>${v}</${k}>`).join("");
  return wrap(`<property>${tags}<desc><en>Nice villa</en></desc>${extra}</property>`);
};

const only = async (xml: string) => {
  const items = await collect(xml);
  expect(items).toHaveLength(1);
  return items[0];
};

describe("KyeroAdapter", () => {
  it("parses the committed sample feed without errors", async () => {
    const items = await collect(createReadStream("fixtures/kyero/sample-feed.xml"));
    expect(items).toHaveLength(300);
    expect(items.every((i) => i.ok)).toBe(true);
  });

  it("maps the fields of a listing", async () => {
    const item = await only(minimal(
      "<location><latitude>38.79</latitude><longitude>0.16</longitude></location><beds>3</beds><baths>2</baths><pool>1</pool>" +
        "<surface_area><built>180</built><plot></plot></surface_area><energy_rating><consumption>b</consumption></energy_rating>",
    ));
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.record).toMatchObject({
      externalId: "A1", priceEur: 250000, listingType: "sale", propertyType: "villa", city: "Jávea",
      region: "Alicante", bedrooms: 3, bathrooms: 2, hasPool: true, livingAreaM2: 180, plotAreaM2: null,
      energyRating: "B", location: { latitude: 38.79, longitude: 0.16 }, translations: { en: "Nice villa" },
    });
    expect(item.record.sourceUpdatedAt.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("keeps supported description locales only and never invents a translation", async () => {
    const xml = minimal().replace("<desc><en>Nice villa</en></desc>", "<desc><es>Bonita</es><de>Schöne Villa</de></desc>");
    const item = await only(xml);
    expect(item.ok && item.record.translations).toEqual({ de: "Schöne Villa" });
  });

  it("orders images by id and drops invalid entries", async () => {
    const images =
      '<images><image id="3"><url>https://img.example/3.jpg</url></image>' +
      '<image id="1"><url>https://img.example/1.jpg</url></image>' +
      '<image id="2"><tags><tag>floorplan</tag></tags><url>https://img.example/2.jpg</url></image>' +
      '<image id="1"><url>https://img.example/dup.jpg</url></image>' +
      '<image id="4"><url>javascript:alert(1)</url></image></images>';
    const item = await only(minimal(images));
    expect(item.ok && item.record.images).toEqual([
      { ordinal: 1, sourceUrl: "https://img.example/1.jpg", isFloorplan: false },
      { ordinal: 2, sourceUrl: "https://img.example/2.jpg", isFloorplan: true },
      { ordinal: 3, sourceUrl: "https://img.example/3.jpg", isFloorplan: false },
    ]);
  });

  it("treats empty and zero optional numbers as unknown", async () => {
    const item = await only(minimal("<beds></beds><baths>0</baths>"));
    expect(item.ok && [item.record.bedrooms, item.record.bathrooms, item.record.location]).toEqual([null, null, null]);
  });

  it.each([
    [{ date: "2026-02-30 10:00:00" }, "INVALID_DATE"],
    [{ date: "01/10/2026" }, "INVALID_DATE"],
    [{ price: "12.5" }, "INVALID_PRICE"],
    [{ price_freq: "week" }, "INVALID_PRICE_FREQ"],
    [{ town: "" }, "MISSING_FIELD"],
    [{ id: "has spaces" }, "INVALID_ID"],
  ])("rejects a record with %o as %s", async (overrides, code) => {
    const item = await only(minimal("", overrides));
    expect(item.ok).toBe(false);
    if (!item.ok) expect(item.error.code).toBe(code);
  });

  it("rejects non-EUR currencies instead of assuming EUR", async () => {
    const item = await only(minimal("<currency>GBP</currency>"));
    expect(!item.ok && item.error.code).toBe("UNSUPPORTED_CURRENCY");
  });

  it("requires a description when there are no features", async () => {
    const item = await only(minimal().replace("<desc><en>Nice villa</en></desc>", ""));
    expect(!item.ok && item.error.code).toBe("MISSING_FIELD");
  });

  it.each([
    ["truncated feed", "fixtures/kyero/invalid-truncated.xml", "MALFORMED_XML"],
    ["DOCTYPE / XXE payload", "fixtures/kyero/invalid-xxe.xml", "DOCTYPE_FORBIDDEN"],
    ["wrong feed_version", "fixtures/kyero/invalid-version.xml", "UNSUPPORTED_VERSION"],
  ])("fails the whole feed on a %s", async (_name, path, code) => {
    const err = await collect(createReadStream(path)).catch((e) => e);
    expect(err).toBeInstanceOf(FeedError);
    expect(err.code).toBe(code);
  });

  it("fails on a feed without properties or with the wrong root", async () => {
    await expect(collect(wrap(""))).rejects.toMatchObject({ code: "EMPTY_FEED" });
    await expect(collect("<feed><property/></feed>")).rejects.toMatchObject({ code: "BAD_ENVELOPE" });
  });

  it("is deterministic and stable under omissions", () => {
    const full = generateKyeroFeed({ count: 5 });
    expect(generateKyeroFeed({ count: 5 })).toBe(full);
    const withoutThird = generateKyeroFeed({ count: 5, omit: new Set([3]) });
    expect(withoutThird).not.toContain("PF-00003");
    expect(withoutThird).toContain(full.slice(full.indexOf("<id>PF-00004"), full.indexOf("<id>PF-00005")));
  });
});

describe("helpers", () => {
  it("cleanText strips control characters and normalises line breaks", () => {
    expect(cleanText("  a\u0007b\r\nc\r\r\r\rd <b>x</b> ")).toBe("ab\nc\n\nd <b>x</b>");
  });

  it("parseKyeroDate accepts valid dates only", () => {
    expect(parseKyeroDate("2024-02-29 23:59:59").toISOString()).toBe("2024-02-29T23:59:59.000Z");
    expect(() => parseKyeroDate("2023-02-29 00:00:00")).toThrow();
    expect(() => parseKyeroDate("2023-01-01 24:00:00")).toThrow();
  });
});
