// Writes the demo feed as it looks on a given simulated day (default: today, UTC).
// Day 0 is the committed sample feed; each later day lowers a few prices.
//   node scripts/simulate-feed.ts --out /var/lib/propertyflow/feed.xml [--day N]

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generateKyeroFeed } from "./kyero-fixture.ts";

const EPOCH = Date.UTC(2026, 9, 27);

const { values } = parseArgs({ options: { out: { type: "string" }, day: { type: "string" } } });
if (!values.out) {
  console.error("usage: simulate-feed --out <path> [--day N]");
  process.exit(2);
}
const day = values.day !== undefined ? Number(values.day) : Math.floor((Date.now() - EPOCH) / 86_400_000);
if (!Number.isInteger(day) || day < 0) {
  console.error("--day must be a non-negative integer");
  process.exit(2);
}
writeFileSync(values.out, generateKyeroFeed({ count: 300, day }));
console.error(`[simulate-feed] wrote day ${day} feed to ${values.out}`);
