# PropertyFlow — Spain property catalogue (technical demo)

**Live demo:** https://propertyflow.potafree.net · **Pipeline status:** https://propertyflow.potafree.net/en/demo/pipeline

A bilingual (EN/DE) Spanish property catalogue fed by an idempotent, Kyero-compatible
XML importer. It exists to show an end-to-end pipeline built with production habits:
SQL migrations, least-privilege access, tests on a real PostgreSQL, safe failure modes
and a scheduled job on a Linux server.

> **All data is synthetic.** Listings, prices, coordinates and descriptions are generated
> by `scripts/kyero-fixture.ts`. Photos are Lorem Picsum placeholders that do not show the
> listed homes. The feed follows the public Kyero V3 structure; *Kyero-compatible* does not
> mean Kyero-certified, and this is not an integration with any real MLS.

## Status

| Area | Status | Evidence |
|---|---|---|
| EN/DE catalogue: search, filters in URL, pagination, detail pages | **Prototype Verified** | Live site; Playwright run against production (`BASE_URL=… pnpm e2e`) |
| Supabase PostgreSQL + PostGIS schema, RLS, grants | **Prototype Verified** | `supabase/migrations/`; anon-role checks in `tests/sync.integration.test.ts` |
| Kyero V3 importer: streaming parse, validation, idempotent upsert | **Prototype Verified** | Import runs on the Pipeline page; integration tests |
| Safe full-snapshot handling (no mass deactivation, drop guard, lock) | **Prototype Verified** | Integration tests; a real truncated-feed run (FAILED, nothing touched) |
| Daily scheduled import + Supabase keepalive (systemd on a VPS) | **Prototype Verified** | `deploy/systemd/`; runs appear on the Pipeline page |
| CI: lint, typecheck, unit + DB integration tests on a fresh Supabase | **Prototype Verified** | `.github/workflows/ci.yml` |
| Image pipeline (Sharp variants → Cloudflare R2) | **Not Yet Implemented** | Images are served directly from the placeholder service |
| 10k/100k-row performance testing | **Not Yet Implemented** | Dataset is 300 listings |
| Real MLS / CRM / enquiry flows | **Not Yet Implemented** | Out of scope |

## Architecture

```mermaid
flowchart LR
  F[Kyero-style XML feed<br/>synthetic, simulated daily] --> I
  subgraph VPS [Linux VPS · systemd timer]
    I[importer CLI<br/>KyeroAdapter → sync]
  end
  I -- session pooler, DB owner role --> DB[(Supabase PostgreSQL<br/>+ PostGIS, RLS)]
  DB -- publishable key, read-only --> W[Next.js 16 on Vercel<br/>/en /de]
  W --> U[Visitors]
  GH[GitHub] -- CI: lint · types · tests on fresh Supabase --> GH
  GH -- push --> W
```

- **Importer** (`workers/importer/`): `FeedAdapter` (format-specific: parse, map, validate)
  → `NormalizedProperty` → generic `sync` (transaction, hashes, counts, last-seen,
  deactivation guards). A new feed format means a new adapter plus fixtures; the database
  and the website do not change.
- **Database** (`supabase/migrations/`): `(source_id, external_id)` unique key, CHECK
  constraints, GiST index on a `geography` column, `properties_near()` radius search,
  RLS policies plus explicit column grants (the public can read active listings and the
  non-sensitive columns of `import_runs`, nothing else, and cannot write).
- **Web** (`app/[locale]/`): Next.js 16 with Cache Components. Pages read through
  `lib/db/catalog.ts` with short `cacheLife`; no page is generated per listing at build
  time. Filters live in the URL and work without JavaScript.

## How the import stays safe

1. Size limit and SHA-256 checksum before parsing.
2. The whole feed is streamed and validated **before any write**. A truncated, malformed,
   wrong-version or DOCTYPE/XXE feed fails as a whole; existing data is untouched.
3. Record-level problems (bad date, unsupported currency, duplicate id…) skip that record
   and are logged; if more than 10% of records are invalid the run fails.
4. Upserts run in one transaction. A content hash (not the feed's `<date>`) decides
   *inserted / updated / unchanged*, so re-running a feed changes nothing.
5. Kyero feeds are full snapshots, but listings missing from a snapshot are only counted.
   Soft deactivation requires `--allow-deactivate` and is refused when the record count
   drops more than 20% against the last completed run. Nothing is ever physically deleted.
6. A PostgreSQL advisory lock per source rejects concurrent runs.

Real output from the production database (`pnpm importer run --adapter kyero --source demo-kyero --file fixtures/kyero/sample-feed.xml`):

```text
first run   {'runId': 1, 'status': 'COMPLETED', 'inserted': 300, 'updated': 0, 'unchanged': 0, 'errors': 0}
same feed   {'runId': 2, 'status': 'COMPLETED', 'inserted': 0, 'updated': 0, 'unchanged': 300, 'errors': 0}
truncated   {'runId': 3, 'status': 'FAILED', 'message': 'MALFORMED_XML: XML is not well-formed: 5230:48: unclosed tag: en', 'deactivated': 0}
```

## Quick start (local)

Requirements: Node 24, pnpm, Docker.

```bash
pnpm install
pnpm exec supabase start -x studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor,gotrue
# applies supabase/migrations to an empty local database

# import the sample feed into the local database
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm importer run --adapter kyero --source demo-kyero --file fixtures/kyero/sample-feed.xml

# web app: point .env.local at a Supabase project (see .env.example), then
pnpm dev
```

Checks:

```bash
pnpm lint && pnpm typecheck
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test   # unit + integration
BASE_URL=http://localhost:3000 pnpm e2e                                              # Playwright demo path
pnpm fixtures   # regenerate fixtures/kyero/*.xml (deterministic)
```

### Importer CLI

```text
pnpm importer run --adapter kyero --source <name> --file <path>
                  [--dry-run] [--preview-removals] [--allow-deactivate] [--drop-threshold 0.2]
```

`--dry-run` runs everything in a transaction that is rolled back (no `import_runs` row).
Exit codes: 0 completed, 1 failed, 2 usage error, 3 another run holds the lock.
The importer reads `DATABASE_URL` (Supabase **session** pooler, port 5432, because the
advisory lock needs a real session), optionally from `.env.importer`.

## Deployment

| Piece | Where | How |
|---|---|---|
| Schema | Supabase | `pnpm exec supabase db push --linked` — **before** deploying code that needs it (pages read the database at build time) |
| Web | Vercel | Push to `main` → production; other branches → preview. Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL` only |
| Importer | Linux VPS | `deploy/push-to-vps.sh <host>` ships a `git archive` of HEAD and runs `deploy/vps/install.sh` |

Secrets never enter the repository or the browser: the web app has only the publishable
key; `DATABASE_URL` exists only in `/etc/propertyflow/importer.env` (root, 0600) on the VPS
and in local, git-ignored files. Previews share the read-only production database, which
is acceptable here because the web app cannot write.

**Rollback:** promote the previous deployment in Vercel. Migrations are written to be
backward compatible with the previous web release; they are not assumed to be reversible.
Operational details: [docs/runbooks.md](docs/runbooks.md).

## Production readiness gaps

- Real feeds: per-provider schema, authentication, IP allow-listing, incremental semantics
  and licensing must be assessed with a real sample; only the `kyero` adapter exists.
- Cross-source de-duplication and source priority are not implemented (slugs are unique
  per listing id; two sources with the same id and town would collide).
- Images: no processing, CDN or lifecycle policy; placeholders are hot-linked.
- No monitoring/alerting beyond systemd journal and the Pipeline page; no backup drill
  (Supabase Free has no point-in-time recovery).
- Capacity: tested with 300 listings; the importer holds one feed in memory per run.

## How this was built

Built with Claude Code under the rules in [CLAUDE.md](CLAUDE.md); review cases and the
workflow are in [docs/claude-code-workflow.md](docs/claude-code-workflow.md).
