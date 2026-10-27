# Working with Claude Code on this repo

Claude Code wrote most of the code; the engineering rules it works under are in
[`CLAUDE.md`](../CLAUDE.md) and the release procedure is the
[`ship-slice`](../.claude/skills/ship-slice/SKILL.md) skill. No hooks, subagents or MCP
servers are configured: nothing in this project needed them.

## Rules that matter most

- Product scope comes from the PRD; infrastructure is fixed (no Redis, queues, ORMs).
- Vertical slices: migration → fixture/adapter → tests → web → deploy.
- A slice is done only after `lint`, `typecheck` and tests ran and their output was read.
- Secrets are referred to by name only; the browser gets only the publishable key.
- README claims must match what actually ran.

## Review cases from building this demo

Each case was found by review (reading code, screenshots or test output), fixed, and is
now covered by a test or a written rule.

**1. "Nearby" mixed monthly rents with sale prices.** The detail page lists listings within
10 km using the PostGIS `properties_near()` function. A screenshot review showed entries
such as "Jávea · €3,000" next to "€345,000": the function did not return `listing_type`, so
rents were shown as if they were sale prices. Fix: a new migration recreating the function
with `listing_type`, and a "/ month" suffix in the UI
(`supabase/migrations/20261027110000_properties_near_listing_type.sql`).

**2. Spanish place names were title-cased naively.** "San Pedro Del Pinatar" (should be
"del"). Fix: particles stay lowercase (`titleCase` in `workers/importer/adapters/kyero.ts`),
with a unit test. Because the normalised content changed, the next import correctly
reported 300 *updated* and the run after it 300 *unchanged*.

**3. Tests that passed on the first run were checked by breaking the code.** The 14
PostgreSQL integration tests all passed immediately, so two guards were broken on purpose:
removing the hash comparison from the upsert made 4 tests fail (idempotency, single update,
date-only change, reactivation); disabling the record-count drop guard made the
"refuses deactivation" test fail. Both were then restored.

**4. A dry-run bookkeeping bug caught before it ran.** The first version of the failure
path in `sync.ts` decided whether to write a FAILED run row with `!(dryRun && !inTx)`. During
a dry run that condition still issued writes inside the dry-run transaction; after a
database error that transaction is aborted, so the bookkeeping write would throw a second
error and hide the original one. Changed to `!dryRun` (a dry run records nothing). This was
caught by reading the code, not by a test; the integration test "dry run writes nothing"
covers the success path only.

**5. Schema must reach production before code.** The first production build failed because
pages query the `property_facets` view at build time and its migration had not been pushed.
This is now step 4 of `ship-slice` and is documented in the README.

**6. A false E2E failure.** Playwright failed 4/4 because an old `next-server` was still
bound to the port and the new build never started. Not a code bug, but the check
("make sure no stale server is bound") is now part of the skill.

**7. No claims ahead of reality.** The Pipeline page text about the daily VPS import was
written early but only rendered after the systemd timer had actually run on the server.
