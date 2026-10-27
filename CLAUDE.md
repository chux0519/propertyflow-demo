@AGENTS.md

# PropertyFlow — project rules

Public technical PoC: a Spain property catalogue (EN/DE) fed by an idempotent
Kyero-compatible XML importer. All listings are **synthetic**. This repo is a
portfolio piece — every claim in README/docs must be backed by something that
actually ran.

## Stack (do not add infrastructure)

- Next.js 16 App Router + TypeScript, `next-intl` for `/en` `/de` routing
- Supabase PostgreSQL 17 + PostGIS; schema changes only via `supabase/migrations/*.sql`
- Importer: Node.js TypeScript CLI in `workers/importer`, independent of Next.js
- Images: pre-processed once with Sharp, served from Cloudflare R2
- Vercel hosting; Linux VPS (systemd timers) for the scheduled import
- No Redis, queues, Elasticsearch, extra ORM. Ask before adding a dependency category.

## Architecture boundaries

- `FeedAdapter` (parse/map/source-format validation only) → `NormalizedProperty`
  → generic `sync` (transactions, counts, last-seen, deactivation guards).
  Adapters never touch the DB; web code never imports from `workers/`.
- Upsert key is `(source_id, external_id)`; inserted/updated/unchanged is decided
  by `normalized_hash`, not by the feed `<date>`.
- Auto-deactivation of missing listings is **off by default** and guarded by
  completeness + drop-threshold checks. No physical delete path.
- XML parsing must never resolve DTDs, external entities or network resources.
- Feed text is untrusted: render as text, never `dangerouslySetInnerHTML`.

## Secrets

- Browser gets only the Supabase **publishable** key. Secret key / `DATABASE_URL`
  live only in the importer environment (VPS `EnvironmentFile`, CI secrets).
- Never print, log or commit secret values. `.env*` is gitignored; `.env.example`
  holds names only.
- The web app is read-only: no route may trigger imports, retries or deploys.

## Workflow

- Work in vertical slices: migration → fixture/adapter → tests → web → deploy.
- Before reporting a slice done, run and read the output of:
  `pnpm lint && pnpm typecheck && pnpm test`
- Never claim a command passed without running it. Record real failures.
- Read `node_modules/next/dist/docs/` before using a Next.js API you are unsure of
  (this Next version differs from older training data: `proxy.ts`, Cache Components).
- README status labels must be honest: Prototype Verified / Locally Tested /
  Not Yet Implemented.
