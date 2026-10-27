---
name: ship-slice
description: Finish a vertical slice of PropertyFlow (schema, importer or web change) and get it to production in the right order with evidence. Use when a change touches migrations, the importer, or pages that read the database.
---

# Ship a slice

Order matters: the web build queries the database, and the VPS runs whatever was last pushed.

1. **Local database up**: `pnpm exec supabase start -x studio,imgproxy,realtime,storage-api,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor,gotrue`.
   New migration? Apply it locally (`psql … -f supabase/migrations/<file>.sql`) or `supabase db reset`.
2. **Checks, read the output**:
   `pnpm lint && pnpm typecheck && TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test`
   If a test passes on the first try and guards something important (idempotency, guards),
   break the code on purpose once and confirm the test fails.
3. **Web changes**: `pnpm build` (Cache Components errors only show up here), `pnpm start`,
   then `BASE_URL=http://localhost:3000 pnpm e2e` and look at screenshots at desktop and
   390px width. Make sure no stale `next-server` is still bound to the port.
4. **Schema to production before code**: `pnpm exec supabase db push --linked --dry-run`, then without `--dry-run`.
5. **Commit and push** to `main`; wait for CI (`check` and `db-integration`) and the Vercel deployment.
6. **Importer changes**: `deploy/push-to-vps.sh <vps-host>`, then
   `sudo systemctl start propertyflow-import.service` and read `journalctl -u propertyflow-import`.
7. **Verify production**: `BASE_URL=https://propertyflow.potafree.net pnpm e2e`.
8. Update README status only with what was actually verified.

Never print secret values; refer to env files by variable name.
