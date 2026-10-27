// Deterministic generator for synthetic Kyero V3 feeds. All listings are fictional.
//   node scripts/kyero-fixture.ts            → writes fixtures/kyero/*.xml
// Also imported by tests and by the daily feed simulator.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface FeedOptions {
  count: number;
  seed?: number;
  /** Simulated day: a few listings get a deterministic price change per day. */
  day?: number;
  /** Remove these listing numbers (1-based) from the feed. */
  omit?: Set<number>;
  /** Raw XML appended inside <root> after the generated properties (for edge-case tests). */
  extraXml?: string;
}

interface Town {
  town: string;
  province: string;
  lat: number;
  lng: number;
}

const TOWNS: Town[] = [
  { town: "Jávea", province: "Alicante", lat: 38.789, lng: 0.166 },
  { town: "Moraira", province: "Alicante", lat: 38.687, lng: 0.136 },
  { town: "Altea", province: "Alicante", lat: 38.599, lng: -0.051 },
  { town: "Calpe", province: "Alicante", lat: 38.645, lng: 0.044 },
  { town: "Dénia", province: "Alicante", lat: 38.840, lng: 0.106 },
  { town: "Torrevieja", province: "Alicante", lat: 37.978, lng: -0.682 },
  { town: "Orihuela Costa", province: "Alicante", lat: 37.932, lng: -0.741 },
  { town: "Marbella", province: "Málaga", lat: 36.510, lng: -4.882 },
  { town: "Estepona", province: "Málaga", lat: 36.426, lng: -5.146 },
  { town: "Nerja", province: "Málaga", lat: 36.758, lng: -3.875 },
  { town: "Mijas", province: "Málaga", lat: 36.596, lng: -4.637 },
  { town: "Fuengirola", province: "Málaga", lat: 36.540, lng: -4.625 },
  { town: "Almuñécar", province: "Granada", lat: 36.734, lng: -3.690 },
  { town: "Salobreña", province: "Granada", lat: 36.746, lng: -3.587 },
  { town: "Palma", province: "Islas Baleares", lat: 39.570, lng: 2.650 },
  { town: "Pollença", province: "Islas Baleares", lat: 39.877, lng: 3.016 },
  { town: "Gandia", province: "Valencia", lat: 38.968, lng: -0.181 },
  { town: "San Pedro del Pinatar", province: "Murcia", lat: 37.835, lng: -0.791 },
];

interface TypeSpec {
  type: string;
  de: string;
  en: string;
  beds: [number, number];
  built: [number, number];
  plot: [number, number] | null;
  price: [number, number];
  poolChance: number;
}

const TYPES: TypeSpec[] = [
  { type: "villa", en: "Villa", de: "Villa", beds: [3, 6], built: [150, 420], plot: [500, 2500], price: [420_000, 2_400_000], poolChance: 0.9 },
  { type: "apartment", en: "Apartment", de: "Wohnung", beds: [1, 3], built: [55, 130], plot: null, price: [140_000, 520_000], poolChance: 0.5 },
  { type: "townhouse", en: "Townhouse", de: "Reihenhaus", beds: [2, 4], built: [90, 180], plot: [60, 200], price: [190_000, 560_000], poolChance: 0.4 },
  { type: "penthouse", en: "Penthouse", de: "Penthouse", beds: [2, 4], built: [90, 220], plot: null, price: [320_000, 1_300_000], poolChance: 0.6 },
  { type: "finca", en: "Country house", de: "Finca", beds: [3, 5], built: [160, 380], plot: [4000, 20000], price: [290_000, 1_100_000], poolChance: 0.7 },
  { type: "bungalow", en: "Bungalow", de: "Bungalow", beds: [2, 3], built: [65, 110], plot: [40, 150], price: [130_000, 320_000], poolChance: 0.6 },
];

const SETTINGS: [string, string][] = [
  ["a short walk from the beach", "nur wenige Gehminuten vom Strand entfernt"],
  ["in a quiet residential area", "in einer ruhigen Wohngegend"],
  ["with open views towards the sea", "mit freiem Blick auf das Meer"],
  ["close to the old town and its restaurants", "in der Nähe der Altstadt und ihrer Restaurants"],
  ["surrounded by citrus groves", "umgeben von Zitrushainen"],
  ["on a well-kept urbanisation with communal gardens", "in einer gepflegten Wohnanlage mit Gemeinschaftsgärten"],
];

const EXTRAS: [string, string, string][] = [
  ["air conditioning", "Air conditioning and double glazing throughout.", "Klimaanlage und Doppelverglasung in allen Räumen."],
  ["parking", "A parking space and storage room are included.", "Ein Stellplatz und ein Abstellraum sind im Preis enthalten."],
  ["terrace", "A covered terrace offers shade through the summer.", "Eine überdachte Terrasse spendet den ganzen Sommer über Schatten."],
  ["fitted kitchen", "The open-plan living area connects to a fully fitted kitchen.", "Der offene Wohnbereich geht in eine voll ausgestattete Küche über."],
  ["sea views", "Sea views from the main bedroom.", "Meerblick vom Hauptschlafzimmer."],
];

// Lorem Picsum photo ids hand-picked for a coastal / Mediterranean look (placeholders only;
// they do not show the listed homes).
const PHOTO_IDS = [10, 12, 13, 14, 16, 37, 49, 74, 75, 77, 78, 108, 116, 162, 163, 164, 199, 215, 281, 308, 322, 323, 350, 369, 372, 374];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function listingId(n: number) {
  return `PF-${String(n).padStart(5, "0")}`;
}

export function generateKyeroFeed(opts: FeedOptions): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- Synthetic demo feed generated by scripts/kyero-fixture.ts. Fictional listings, not real properties. -->",
    "<root>",
    "  <kyero>",
    "    <feed_version>3</feed_version>",
    "  </kyero>",
  ];

  for (let n = 1; n <= opts.count; n++) {
    // Per-listing PRNG so omitting or mutating one listing never changes the others.
    const r = rng((opts.seed ?? 2026) * 100_003 + n);
    const between = ([lo, hi]: [number, number]) => lo + Math.floor(r() * (hi - lo + 1));
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];

    const town = pick(TOWNS);
    const spec = pick(TYPES);
    const rent = r() < 0.15;
    const beds = between(spec.beds);
    const baths = Math.max(1, beds - (r() < 0.5 ? 1 : 0));
    const built = between(spec.built);
    const plot = spec.plot ? between(spec.plot) : null;
    const pool = r() < spec.poolChance;
    const newBuild = r() < 0.12;
    let price = rent
      ? Math.round(between([700, 3800]) / 50) * 50
      : Math.round(between(spec.price) / 5000) * 5000;
    const minutes = Math.floor(r() * 60 * 24 * 50);
    const date = new Date(Date.UTC(2026, 8, 1) + minutes * 60_000);
    const setting = pick(SETTINGS);
    const extras = EXTRAS.filter(() => r() < 0.45);
    const lat = town.lat + (r() - 0.5) * 0.04;
    const lng = town.lng + (r() - 0.5) * 0.04;
    const imageCount = between([3, 6]);
    const photoIds = Array.from({ length: imageCount }, () => pick(PHOTO_IDS));
    const hasGerman = r() > 0.1; // ~10% exercise the EN fallback
    const energy = pick(["A", "B", "C", "D", "E", "X"]);

    if (opts.omit?.has(n)) continue;

    let changedDate = date;
    // Each simulated day reduces the price of 3 listings by 2–6%; changes accumulate.
    for (let d = 1; d <= (opts.day ?? 0); d++) {
      for (let k = 0; k < 3; k++) {
        if ((d * 7 + k * 101) % opts.count === n - 1) {
          price = Math.round((price * (1 - (2 + ((d + k) % 5)) / 100)) / 50) * 50;
          changedDate = new Date(Date.UTC(2026, 9, 27) + d * 86_400_000);
        }
      }
    }

    const bedsEn = beds === 1 ? "1 bedroom" : `${beds} bedrooms`;
    const bedsDe = beds === 1 ? "1 Schlafzimmer" : `${beds} Schlafzimmern`;
    const en = [
      `${spec.en} with ${bedsEn} in ${town.town}, ${setting[0]}.`,
      pool ? "The private pool and terrace are ideal for long summer evenings." : "",
      `Built area of ${built} m²${plot ? ` on a plot of ${plot} m²` : ""}.`,
      ...extras.map((e) => e[1]),
      newBuild ? "New build, completed within the last year." : "",
      rent ? "Available for long-term rental." : "",
      "Synthetic demo listing, not a real property.",
    ].filter(Boolean).join(" ");
    const de = [
      `${spec.de} mit ${bedsDe} in ${town.town}, ${setting[1]}.`,
      pool ? "Der private Pool und die Terrasse sind ideal für lange Sommerabende." : "",
      `Wohnfläche ${built} m²${plot ? ` auf einem Grundstück von ${plot} m²` : ""}.`,
      ...extras.map((e) => e[2]),
      newBuild ? "Neubau, im letzten Jahr fertiggestellt." : "",
      rent ? "Für die Langzeitmiete verfügbar." : "",
      "Synthetisches Demo-Objekt, keine echte Immobilie.",
    ].filter(Boolean).join(" ");

    const fmtDate = changedDate.toISOString().slice(0, 19).replace("T", " ");
    out.push(
      "  <property>",
      `    <id>${listingId(n)}</id>`,
      `    <date>${fmtDate}</date>`,
      `    <ref>DEMO-${n}</ref>`,
      `    <price>${price}</price>`,
      "    <currency>EUR</currency>",
      `    <price_freq>${rent ? "month" : "sale"}</price_freq>`,
      `    <new_build>${newBuild ? 1 : 0}</new_build>`,
      `    <type>${spec.type}</type>`,
      `    <town>${esc(town.town)}</town>`,
      `    <province>${esc(town.province)}</province>`,
      "    <country>Spain</country>",
      "    <location>",
      `      <latitude>${lat.toFixed(6)}</latitude>`,
      `      <longitude>${lng.toFixed(6)}</longitude>`,
      "    </location>",
      `    <beds>${beds}</beds>`,
      `    <baths>${baths}</baths>`,
      `    <pool>${pool ? 1 : 0}</pool>`,
      "    <surface_area>",
      `      <built>${built}</built>`,
      plot ? `      <plot>${plot}</plot>` : "      <plot></plot>",
      "    </surface_area>",
      "    <energy_rating>",
      `      <consumption>${energy}</consumption>`,
      "      <emissions>X</emissions>",
      "    </energy_rating>",
      "    <desc>",
      `      <en>${esc(en)}</en>`,
      hasGerman ? `      <de>${esc(de)}</de>` : "",
      "    </desc>",
      "    <features>",
      ...[pool ? "private pool" : "", ...extras.map((e) => e[0])].filter(Boolean).map((f) => `      <feature>${f}</feature>`),
      "    </features>",
      "    <images>",
      ...photoIds.map(
        (id, i) => `      <image id="${i + 1}"><url>https://picsum.photos/id/${id}/1600/1200.jpg</url></image>`,
      ),
      "    </images>",
      "  </property>",
    );
  }

  if (opts.extraXml) out.push(opts.extraXml);
  out.push("</root>", "");
  return out.filter((l) => l !== "").join("\n") + "\n";
}

function writeFixtures() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "kyero");
  mkdirSync(dir, { recursive: true });
  const full = generateKyeroFeed({ count: 300 });
  writeFileSync(join(dir, "sample-feed.xml"), full);

  // Cut mid-record: what a dropped connection leaves behind.
  writeFileSync(join(dir, "invalid-truncated.xml"), full.slice(0, Math.floor(full.length * 0.4)));

  writeFileSync(
    join(dir, "invalid-xxe.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE root [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<root><kyero><feed_version>3</feed_version></kyero>
<property><id>XXE-1</id><date>2026-01-01 00:00:00</date><ref>x</ref><price>1</price>
<price_freq>sale</price_freq><type>villa</type><town>&xxe;</town><province>Alicante</province>
<desc><en>attack</en></desc></property></root>
`,
  );

  writeFileSync(
    join(dir, "invalid-version.xml"),
    generateKyeroFeed({ count: 3 }).replace("<feed_version>3</feed_version>", "<feed_version>2_1</feed_version>"),
  );
  console.log(`wrote fixtures to ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFixtures();
