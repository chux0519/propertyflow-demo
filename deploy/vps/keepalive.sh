#!/usr/bin/env bash
# Invoked by propertyflow-keepalive.service. A cheap public read so the free-tier
# Supabase project never looks inactive. Uses only the publishable (browser) key.
set -euo pipefail
curl -fsS --max-time 20 -o /dev/null -w "keepalive: HTTP %{http_code} in %{time_total}s\n" \
  -H "apikey: ${SUPABASE_PUBLISHABLE_KEY:?}" \
  "${SUPABASE_URL:?}/rest/v1/import_runs?select=id&order=id.desc&limit=1"
