// Usage:
//   pnpm importer run --adapter kyero --source demo-kyero --file fixtures/kyero/sample-feed.xml
//     [--dry-run] [--preview-removals] [--allow-deactivate] [--drop-threshold 0.2]
// Prints a JSON summary on stdout; progress goes to stderr.
// Exit codes: 0 completed, 1 failed, 2 usage error, 3 another run holds the lock.

import { parseArgs } from "node:util";
import pg from "pg";
import { KyeroAdapter } from "./adapters/kyero.ts";
import type { FeedAdapter } from "./adapters/types.ts";
import { ConcurrentRunError, runSync } from "./sync.ts";

const adapters: Record<string, () => FeedAdapter> = {
  kyero: () => new KyeroAdapter(),
};

function usage(message: string): never {
  console.error(`error: ${message}`);
  console.error("usage: importer run --adapter <kyero> --source <name> --file <path> [--dry-run] [--preview-removals] [--allow-deactivate] [--drop-threshold <0-1>]");
  process.exit(2);
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      adapter: { type: "string" },
      source: { type: "string" },
      file: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "preview-removals": { type: "boolean", default: false },
      "allow-deactivate": { type: "boolean", default: false },
      "drop-threshold": { type: "string", default: "0.2" },
    },
  });

  if (positionals[0] !== "run") usage("unknown command");
  if (!values.adapter || !adapters[values.adapter]) usage(`--adapter must be one of: ${Object.keys(adapters).join(", ")}`);
  if (!values.source) usage("--source is required");
  if (!values.file) usage("--file is required");
  const dropThreshold = Number(values["drop-threshold"]);
  if (!(dropThreshold >= 0 && dropThreshold < 1)) usage("--drop-threshold must be in [0, 1)");
  if (values["allow-deactivate"] && values["dry-run"]) usage("--allow-deactivate cannot be combined with --dry-run");
  if (!process.env.DATABASE_URL) usage("DATABASE_URL is not set");

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, application_name: "propertyflow-importer" });
  await db.connect();
  try {
    const summary = await runSync(db, {
      adapter: adapters[values.adapter](),
      sourceName: values.source,
      filePath: values.file,
      dryRun: values["dry-run"],
      allowDeactivate: values["allow-deactivate"],
      dropThreshold,
      log: (m) => console.error(`[importer] ${m}`),
    });
    if (values["preview-removals"]) {
      console.error(`[importer] ${summary.removalPreview} active listing(s) are missing from this snapshot (not deactivated)`);
    }
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.status === "COMPLETED" ? 0 : 1;
  } catch (err) {
    if (err instanceof ConcurrentRunError) {
      console.error(`[importer] ${err.message}`);
      process.exitCode = 3;
    } else {
      throw err;
    }
  } finally {
    await db.end();
  }
}

await main();
