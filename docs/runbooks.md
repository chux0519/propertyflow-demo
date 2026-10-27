# Runbooks

## Check the scheduled jobs (VPS)

```bash
systemctl list-timers 'propertyflow-*'
journalctl -u propertyflow-import --since today        # JSON summary of each run
journalctl -u propertyflow-keepalive --since -2d
sudo systemctl start propertyflow-import.service        # run now (the DB lock prevents overlaps)
```

The service runs as the unprivileged `propertyflow` user with `ProtectSystem=strict`; its
only writable path is `/var/lib/propertyflow` (the generated feed). Secrets live in
`/etc/propertyflow/*.env` (root, 0600) and are read by systemd, not by the user.

## An import failed

1. `journalctl -u propertyflow-import -n 100` — the last JSON line has `status` and `message`.
2. Feed-level failures (`MALFORMED_XML`, `DOCTYPE_FORBIDDEN`, `TOO_MANY_RECORD_ERRORS`, …)
   leave the catalogue exactly as it was; fix or replace the feed and re-run.
3. `Internal error (see importer logs)` means a non-feed error (database, network); the
   stack trace is in the journal, never on the public page.
4. Exit code 3: another run holds the advisory lock. Check for a stuck session:
   `select pid, application_name, state from pg_stat_activity where application_name = 'propertyflow-importer';`

Per-record problems of a run: `select * from import_errors where run_id = <id>;` (not exposed publicly).

## Listings disappeared from the site

The importer never deletes rows and only soft-deactivates with `--allow-deactivate`, so check:

```sql
select status, count(*) from properties group by 1;
select id, status, feed_record_count, removal_preview_count, deactivated_count, error_summary
from import_runs order by id desc limit 10;
```

To restore listings wrongly deactivated, re-run the importer with a complete feed: listings
present in the feed are reactivated (counted as *updated*).

## Deploy

1. Schema first: `pnpm exec supabase db push --linked` (preview with `--dry-run`).
2. Web: merge to `main`; Vercel builds and promotes. Pages query the database during the
   build, so a missing migration fails the build instead of breaking production.
3. Importer: `deploy/push-to-vps.sh <host>` (idempotent; re-installs units and dependencies).

## Roll back

- Web: Vercel → Deployments → promote the previous production deployment.
- Importer: check out the previous commit and run `deploy/push-to-vps.sh <host>` again.
- Database: migrations are additive and backward compatible with the previous release.
  A destructive change would need its own forward migration; do not hand-edit production.

## Backups

Platform backups depend on the Supabase plan; this demo runs on the Free plan and does not
rely on them. For a portable copy:

```bash
pg_dump "$DATABASE_URL" --schema=public --no-owner -Fc -f propertyflow-$(date +%F).dump
```

The catalogue itself is reproducible: an empty database + migrations + the fixture feed
rebuild it (`import_runs` history is the only state that is not).

## Supabase project paused

Free projects pause after a period of inactivity. The keepalive timer reads one row every
12 hours and the daily import connects as well; if the project was paused anyway, restore
it from the Supabase dashboard and check `journalctl -u propertyflow-keepalive`.
