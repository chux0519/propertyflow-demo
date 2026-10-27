#!/usr/bin/env bash
# Invoked by propertyflow-import.service. Generates today's simulated feed and imports it.
set -euo pipefail
cd /opt/propertyflow
feed="${STATE_DIRECTORY:?}/feed.xml"
node scripts/simulate-feed.ts --out "$feed"
exec node workers/importer/cli.ts run --adapter kyero --source demo-kyero --file "$feed"
