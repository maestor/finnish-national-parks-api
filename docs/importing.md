# Importing Guide

This repo has three separate import paths:

- `npm run import:parks` for the main LIPAS-backed catalog import
- `npm run import:special-parks` for curated non-LIPAS additions that still belong in the shared park catalog
- `npm run import:osm-trails` for supplemental OpenStreetMap routes linked to existing areas

The main LIPAS import does not block on raw upstream count drift.
When `npm run import:parks` finds brand-new parks, it imports them as removed so they stay hidden until you explicitly enable them from the admin UI, and it prints the newly added names in the CLI output.
Use `npm run import:parks -- --dry-run` for the same preview without persisting
imported parks or import runs. The manual CLI applies pending schema migrations
before either mode; the scheduled command below never applies migrations.

Use this guide when you need to reproduce or extend the curated special import workflow.

See the [catalog data source](../README.md#data-source) for supported LIPAS types.
Attribute LIPAS data to Jyväskylän yliopisto, Lipas Liikuntapaikat.fi, with the
sampling date. The Luontoon.fi sitemap supplies visitor links.
[LIPAS CC BY 4.0 terms](https://www.jyu.fi/fi/liikunta/yhteistyo/lipas-liikunnan-paikkatietojarjestelma/avoimet-rajapinnat-ja-ladattavat-lipas-aineistot)

## Trail–area reconciliation

Visits may reference an area's linked trails. Assigning a trail to a visit pins that membership with an inclusion override; imports still refresh geometry and automatic-match measurements but retain the membership even if overlap disappears. Draft visits protect membership too. The admin unlink endpoint reports blocking visits for review; direct deletion/exclusion of a used relationship fails at the database boundary. Remove the trail from every relevant visit before unlinking it. The park-visit move command likewise rejects a move to a park without all assigned trails; review and clear assignments first. Inactive source trails retain historical assignments but are omitted from public map choices.

Both import paths insert new records disabled and preserve existing visibility and editable fields. The LIPAS import retains supported source-active trails, then clips route lines against active stored area polygons in WGS84 and measures the resulting lengths in EPSG:3067. Each area covering at least 10% of measured route length qualifies independently, without a distance floor or buffer; comparison uses a 1e-7 ratio tolerance for projection and floating-point precision. Invalid polygons and wholly degenerate trails are reported without automatic matches. When a trail contains both usable and zero-length line parts, the usable parts are measured and the degenerate parts are flagged in the report and link metadata; no geometry is repaired. A trail without usable coordinates retains its last known bounds and marker; a new trail without usable coordinates uses a private zero-coordinate placeholder and cannot be enabled until coordinates exist. An area without usable coordinates fails the import. Both import paths fetch and validate their source batch before committing catalog or relationship changes. Special-import trails remain independent; special areas can be parents. An effective link hides a trail as a standalone destination, and removing the last match does not automatically republish it; an explicit enable restores independence only when no effective link remains. No visit records are moved or rewritten.

The LIPAS `route-length-km` property is stored as nullable `lengthKm` independently of the geometry measurements used for matching. Re-imports refresh the source value while preserving administrator edits, as with area. Existing rows receive their source length on the next LIPAS import after migration `0048_trail_length.sql`; missing values remain null.

### Long trails

Catalog admission and admin visibility do not use a maximum trail length.
Length edits survive reimport, and automatic area matching still uses the full
unique mapped line length. A supported, source-active trail previously retired
for length is restored in place on reimport, with its existing visits, manual
links and visibility intact. New and previously hidden standalone trails still
need an explicit enable to appear as standalone destinations.

To restore LIPAS trails, preview and apply the regular import below and clear
the UI's public park caches after applying. Existing trail and area IDs stay
the same. Formerly retired OSM trails can return through the regular OSM import
when they meet its area match and duplicate checks.

To reduce traffic to remote libSQL, the main import upserts at most ten parks per statement, with a 1 MiB geometry budget per batch. Trail reconciliation loads geometry in groups of at most 50 records and 2 MiB. A single geometry larger than a budget is sent or read on its own. During lengthy geometry matching, periodic lightweight queries keep the remote transaction stream active. All catalog writes, reconciliation and notification queuing remain in one transaction; dry runs roll it back.

Back up the target database before applying. Run `npm run import:parks -- --dry-run` first. The dry run rolls back catalog changes and reports new rows, automatic links, exclusions, deactivations, in-place source transfers and affected public slugs. A trail with visits that would newly become a member aborts the transaction. See [the parent-area import workflow](#import-a-parent-area-for-a-trail-with-visits). After review, run `npm run import:parks` and immediately expire every reported slug through the UI's authenticated `POST /api/revalidate-public-cache` with `{ "parkSlugs": ["slug"] }` (maximum 500 per request). That endpoint also expires summary, map, planner and sitemap paths. API ETags do not invalidate the UI cache by themselves. Repeat the dry run to check stability before rollout.

A scheduled import rolls back when it would newly hide an enabled trail, because it cannot perform the UI's authenticated expiry. Review the reported slugs and run the manual import. If an affected trail moves under a newly imported parent, enable the approved parent in the admin UI so its trail stays publicly accessible. Expire the affected parent and trail URLs immediately. Special-area imports have the same guard; after review a single area can be imported with `npm run import:special-parks -- --allow-public-trail-conversions <slug>`, followed immediately by expiry of every printed slug. The default special-import command refuses that conversion.

Admin-session endpoints `GET /api/admin/parks/{slug}/trails` and `/trail-candidates` expose private link and candidate data; `PUT`/`DELETE /api/admin/parks/{slug}/trails/{trailId}` record durable inclusion/exclusion overrides. The candidate read accepts `q`, `limit` (1–100) and `offset`. An API key alone is insufficient. Callers making a manual change must immediately expire both the area slug and returned trail slug through the same UI endpoint. Public area detail requests with `includeBoundary=true` include effective linked trails, their names, available addresses and lengths, and stored geometry. Park detail caches revalidate after one hour to pick up scheduled imports; immediately expire affected area details after an import when prompt updates are required. No relation editor is included.

### Seitsemän veljeksen vaellusreitti

The LIPAS import consolidates records `524135`, `528635`, `528636`, `601262`,
`602277` and `602303` into the existing trail for `524135`. The combined map
includes both Vantaa branches and the connecting trails. The displayed source
length is the unique mapped line length. Existing administrator edits on the
canonical record survive refresh.

Preview and apply the first merge through the manual LIPAS workflow above
when it affects public trails. The scheduled import then requires manual
application so the affected UI caches can be expired immediately. Once merged,
absorbed IDs stay inactive and are omitted from admin visibility and area trail
lists. Later imports rebuild the combined route when all six components are
usable. If a component is missing or invalid, the importer logs a warning and
retains the last complete combined route.

The standard 10% calculation uses the full combined geometry for each area.
Automatic matches from individual components are recalculated. Explicit
inclusions and visit assignments carry over to the canonical trail. Direct
visits on an absorbed record or a conflicting canonical exclusion stop the
first merge for operator review. To resolve a reported exclusion and preserve
the existing area membership, open **Reitit → Alueen reitit** for the reported
area. Search by trail name, choose **Lisää**, and confirm the canonical slug
shown by the import error. Keep existing visit assignments and rerun the dry
run. A new trail with no effective area link follows the usual admin visibility
workflow.

### Import a parent area for a trail with visits

Back up the target catalog and verify the conversion on an isolated copy. The
default special import rolls back if it would convert an independent trail that
still has visits. Import the new area by explicit slug with reconciliation
deferred for that run.

```sh
npm run import:special-parks -- --defer-trail-links <area-slug>
```

1. Enable the new area in admin. New special areas start disabled.
2. Preview the visit move with the command below. Check the reported visits and
   photos, then repeat without `--dry-run`. Use `--visit-id <id>` in place of
   `--from <trail-slug>` to move a single visit.
3. Include the trail in the area's **Reitit** tab after moving its visits, then
   assign it to the relevant moved visits.
4. Verify the area and linked trail. Expire the area and former standalone trail
   URLs and the shared visit and trip caches. Run subsequent imports without
   the defer flag to resume normal matching.

```sh
npm run park:move-visits -- --from <trail-slug> --to <area-slug> --dry-run
```

## Supplemental OpenStreetMap trails

The OSM importer operates independently of the LIPAS and special-park imports.
It requires migration `0049_osm_trails.sql` to have already been applied; it
never runs migrations. Set `DATABASE_URL` deliberately. Run:

```sh
npm run import:osm-trails -- --dry-run
```

The command fetches named hiking and foot route relations from the Europe
Overpass service (`https://ovp.dresel.systems/api/interpreter`), selects routes
intersecting current active area bounds, and downloads their complete nested
relation members in batches. Requests have a 60-second timeout. Partial server
responses abort the run; routes with missing member geometry or ambiguous
reported lengths are skipped. It does not invent route segments. OSM `distance`
without a unit means kilometres and `length` without a unit means metres.
Normal application reads remain local and never call Overpass.

The importer caches its source snapshot in `data/osm-trails-snapshot.json`
(ignored by Git) for one hour. A dry run and an import within that period use the
same snapshot when area bounds have not changed. After the cache expires or area
bounds change, the next run fetches a fresh snapshot. National-park results
appear first, followed by other areas.

The dry run lists trails that would be added or updated, their matched area names,
OSM relation IDs, measured lengths and review flags. It rejects nearby same-name
matches and routes whose sampled geometry is at least 90%
within 25 m of a stored trail or a longer selected OSM route. The geometric
screen is approximate and the report requires review. Local length and name
edits and manual link overrides survive refreshes. Missing source relations and
routes with no current area match are not withdrawn automatically. Automatic
links which cease matching on an otherwise eligible refreshed route are removed
or disabled while manual overrides remain.

After review and backup, run `npm run import:osm-trails` to import and immediately
use the UI's full cache clear to refresh the affected areas. An unchanged rerun does not
write catalog records. The public linked-trail representation identifies its
OSM relation and carries attribution and the ODbL licence URL. Source data is
© OpenStreetMap contributors, available under the Open Database License:
https://www.openstreetmap.org/copyright. Retain the source snapshot and review
ODbL obligations for public distribution of the resulting database before
publishing imported data.

### Selected linked trails

The selected-trail importer reads a tracked manifest and geometry from
[src/importer/selected-trails/](../src/importer/selected-trails). It verifies source
identities and hashes before writing. Nominal walking distance is separate
from measured unique line length. Networks without an agreed traversal keep
a null displayed length.

Set the intended `DATABASE_URL` and optional `DATABASE_AUTH_TOKEN`, verify a backup and apply pending migrations through the normal deployment workflow. The command checks for pending migrations and never applies them:

```sh
npm run import:selected-trails -- --selection visited-trails-2026-11 --dry-run
npm run import:selected-trails -- --selection visited-trails-2026-11
```

The normal report groups trails by parent area and summarizes additions, updates and unchanged entries. Use `--json` for the complete source identities, geometry hashes, distant namesakes and affected cache slugs. To save a clean JSON preview, run:

```sh
DOTENV_CONFIG_QUIET=true npm run --silent import:selected-trails -- --selection visited-trails-2026-11 --dry-run --json > selected-trails-preview.json
```

Review the preview's manifest hash, source identities, geometry hashes, resolved parents, actions and affected cache slugs before applying the same files. Missing/inactive parents, nearby same-name trails or same-name trails linked to the selected parent, changed snapshots, selected link exclusions, merged sources and independent trails with direct visits abort the batch. Name collisions use a conservative bounding-box margin of 0.1° latitude and 0.3° longitude; unrelated distant namesakes are listed in `distantNamesakes` and are never reused or changed. Only matching relation-owned rows can be reused; other ambiguous candidates need an explicit preservation decision. The transaction preserves visits, photos, existing unrelated links and administrator name/length edits. New rows are linked-only and hidden as standalone destinations. An unchanged rerun writes nothing and reports no affected slugs.

After applying, immediately expire every reported UI park cache through the authenticated cache-clear workflow; API version changes do not invalidate Next.js caches. Retain the report and manifest hash as operator evidence. Regular LIPAS/special-area reconciliation preserves selected membership, and regular OSM discovery reports relation geometry drift while retaining the accepted snapshot. Revision of the accepted snapshot requires a separate reviewed implementation; selected snapshots cannot enter manual merges. Source attribution and ODbL links remain in the public contract.

### Merged OSM trail refresh

Maintainers can [merge linked OSM trails manually](development.md#merge-linked-trails). Original relation identities and raw component snapshots remain separate from the destination's combined geometry. The public linked-trail `source.relations` array lists every contributing relation ID and URL; existing singular `relationId`/`sourceUrl` fields still identify the destination's primary source.

Known merge members refresh before duplicate/containment filtering. The importer rebuilds each changed destination once from current valid components, preserving its chosen name, slug, administrator length correction and manual memberships. Absorbed sources stay inactive and hidden; database guards also prevent re-enabling them. A missing or rejected member keeps its last valid component and is reported, while valid members can still refresh. Invalid combined geometry or concurrent edits abort the transaction instead of partly replacing snapshots. Normal reads remain local-first. An unchanged rerun writes nothing.

New automatic area matches use combined geometry and are included in the affected cache slugs. Previously pinned memberships survive geometry changes. After import, immediately clear the UI's public caches as above; API data-version updates do not expire them. LIPAS area imports and long-trail retirement retain source identities and merge membership. Source snapshots cannot be treated as a reversible edit history: there is no automatic unmerge.

## Weekly LIPAS automation

The API repository's `Weekly LIPAS Import` workflow runs every Monday at 09:43
in `Europe/Helsinki`, including daylight saving time. To run it manually against
production, open **Actions → Weekly LIPAS Import → Run workflow**, select
`main`, and start the run. Manual runs use the same backup, safeguards,
notifications and concurrency as scheduled runs; other branches are skipped.
Use `npm run import:parks` for imports from your computer.

Each run backs up production to a GitHub Actions artifact retained for 14 days,
then runs `npm run import:parks:scheduled` using the `production` environment's
existing `DATABASE_URL` and `DATABASE_AUTH_TOKEN` secrets. It shares the
`production-database` concurrency group with production migrations and never
applies migrations itself. Migrations `0046_park_import_notifications.sql` and `0047_trail_area_links.sql` must
be applied by the normal production migration workflow before the first import.

New parks stay hidden until enabled in the admin UI. A run with new parks opens
one Finnish review issue with their names, types and LIPAS IDs, mentioning only
`@maestor`. With no additions, it creates no issue. Existing parks are refreshed
using the same import and preservation rules as the manual command; missing
LIPAS-managed parks become inactive. Normal API reads remain local-first, and
public trail conversions requiring immediate cache expiry use the manual workflow above.

Notification reports are queued in the same database transaction as the import.
Failed notifications remain queued for the next workflow run, which retries
them before fetching LIPAS. A hidden import-run marker in each issue prevents
duplicates if GitHub accepted an issue but database acknowledgement failed;
closed issues are included in that check. Keep that marker when editing issues.
Local manual imports and dry runs do not queue GitHub notifications.

GitHub supplies the short-lived `GITHUB_TOKEN` with `issues: write` and
`GITHUB_REPOSITORY` to this workflow; no personal token or mail service is needed.
Issues must be enabled on the repository. For email delivery, `maestor` must
enable email for participating conversations in
[GitHub notification settings](https://github.com/settings/notifications).
Environment protection rules must allow unattended scheduled runs if fully
automatic operation is desired. GitHub schedules can be delayed, and public
repositories' schedules are disabled after 60 days without repository activity.
After merging, verify the first scheduled run in Actions and the notification
settings; local tests do not send real issues or emails.

## Entry Points

The normal special-import edit path is:

- [src/importer/import-special-parks.ts](../src/importer/import-special-parks.ts)
- [src/importer/special-parks/](../src/importer/special-parks)
- [tests/integration/manual-catalog.integration.test.ts](../tests/integration/manual-catalog.integration.test.ts)
- [tests/fixtures/special-parks.ts](../tests/fixtures/special-parks.ts) when the source stays remote in tests
- `src/importer/special-parks/data/<slug>.json` when the source should be stored locally as `special://...`

## Source Selection

Prefer official, machine-readable geometry first.

- Use Luontoon first for `parkUrl` when a clear destination page exists.
- If Luontoon does not have a suitable page, use another clearly suitable official page instead of inventing a URL.
- Preserve the user-requested public-facing imported `name` even when the official source title differs.
- Prefer the existing special/manual import model before introducing a new ingestion path.

For geometry:

- Prefer official polygon or line geometry over point-only sources.
- If the official source only gives a validated point and the user accepts the tradeoff, store a pragmatic local proxy geometry under `special://...`.
- Prefer local `special://...` GeoJSON for municipality-specific manual imports once the official geometry choice is clear. That keeps the import stable and the tests deterministic.

## Helsinki Workflow

Start with the official open WFS:

```text
https://kartta.hel.fi/ws/geoserver/avoindata/wfs
```

Useful Helsinki layers:

- `avoindata:YLRE_Viheralue_alue`
  - best first choice when you need the published park-area geometry
  - useful fields: `puiston_nimi`, `osoite`, `osa_alue`, `viheralueen_pa`
- `avoindata:YLRE_Katu_ja_viherosat_eiliikenne_alue`
  - more detailed maintenance and sub-area pieces
  - useful fields: `alueen_nimi`, `alueen_kayttotarkoitus`, `osan_pinta_ala`, `viheralueen_id`

Typical WFS query shape:

```text
service=WFS
request=GetFeature
version=2.0.0
typeNames=avoindata:YLRE_Viheralue_alue
outputFormat=application/json
srsName=EPSG:4326
```

Filter the park layer by `puiston_nimi` and the sub-area layer by `alueen_nimi`. Prefer the park layer when it contains the full published boundary. The source name may differ from the catalog name.

## Vantaa municipal-plan workflow

Vantaa publishes open WMS/WFS interfaces, including coordinate-system guidance, but a park-area boundary is not necessarily available as a reusable WFS feature layer. When a published municipal park plan is the clearest official boundary source:

- confirm the landmark or address through Vantaa's WFS in `EPSG:4326`
- use the published plan's marked `puistoalueen raja` as the source boundary
- store a simplified, attributed WGS84 snapshot under `special://...`, including the source plan URL and its source coordinate system in the GeoJSON properties

## Reusable Workflow Families

The special-parks importer already has a few source families that are worth reusing instead of inventing a new pattern each time.

### 1. SYKE protected sites WFS

Use this when the park already exists in SYKE protected-sites data.

- builder in code: `buildSykeProtectedSitesSourceUrl`
- source parser: default SYKE parser
- common use: nature-reserve areas, natural parks, many soidensuojelualue rows
- geometry source: SYKE protected-sites WFS
- metadata source: `shape_area` and `paatpvm`

Typical shape:

- store a `SykeSpecialParkSeed`
- set `sourceName` to the official SYKE feature name
- optionally set `sourceType: 'private'` when the data lives in the private-land layer
- keep the imported `name` user-facing, even if it differs slightly from `sourceName`

Use the composite variant when one park should be assembled from several official SYKE features:

- builder in code: `buildSykePrivateProtectedSitesCompositeSourceUrl`
- example pattern: `Sanginjoki`
- use this when the final imported row is one place, but the official SYKE coverage is split across multiple named source features

### 2. Museovirasto protected sites WFS

Use this for the smaller set of curated history places that live under the Museovirasto protected-sites layer instead of RKY area polygons.

- builder in code: `buildMuseovirastoProtectedSitesSourceUrl`
- layer family: `muinaisjaannos_alue`
- helper in code: `createMuseovirastoSpecialParkConfig`

### 3. Museovirasto RKY area workflow

Use this when the place should come from the RKY areas layer.

- builder in code: `buildMuseovirastoRkyAreaSourceUrl`
- layer family: `rky_alue`
- helper in code: `createMuseovirastoRkyAreaConfig`

This workflow already supports the common edge cases:

- `sourceName`
  - the official RKY registry title used for the WFS lookup
- `name`
  - the stored user-facing import name
- `sourceFeatureName`
  - narrows the WFS result when one `kohdenimi` covers several distinct sub-areas
- `excludedSourceNames`
  - excludes known false-positive sibling features from a broader RKY match

Filters select whole published features. To use only part of a feature, store a reviewed local snapshot and record the clipping method.

### 4. World heritage WFS with feature ID filtering

Use this when the source is the Museovirasto world-heritage layer and the importer needs one exact feature from a broader dataset.

- parser in code: `world-heritage-area`
- filter field in code: `sourceFeatureId`

### 5. Curated OpenStreetMap way selections

Use tracked `special://` GeoJSON for a reviewed trail assembled from OSM
ways. Specify the source way IDs and retrieval time in the config so the
importer can register the selection and expose OSM attribution for linked
trails. Record the way version and any clipping node IDs beside the geometry.

### 6. Repo-local `special://` geometry

Use this when imports should load a stored geometry snapshot instead of fetching
the source live.

- `special://<slug>` maps to `src/importer/special-parks/data/<slug>.json`
- the importer loads these files directly from the repo
- `tests/fixtures/special-parks.ts` does not need an entry for local `special://` sources

Record the source URL, feature IDs, retrieval date, attribution, license, and
any clipping, simplification, or other processing alongside the GeoJSON. For
municipal plans and visitor maps, record the mapped extent and any approximation
introduced by georeferencing. Retain all polygon parts and holes within the
chosen scope. Union overlapping selections in the source projected CRS before
transforming to WGS84. Keep visitor markers and addresses separate from the
geometry, and omit LIPAS contact details and comments.

Inspect the [checked-in snapshots](../src/importer/special-parks/data) and their
[configurations](../src/importer/special-parks) before refreshing an existing
boundary. Preserve catalog IDs and slugs, and compare visits, linked trails,
and standalone visibility on an isolated database copy before applying.

### 7. Geological SYKE GeoJSON workflow

Use this when the geometry comes from a non-protected-sites SYKE layer rather than the standard protected-sites WFS.

- builder in code: `buildSykeGeologicalRockAreaSourceUrl`
- source parser: `geojson`
- metadata source: `area_m2` when the layer exposes it in GeoJSON properties

## Geometry And Metadata Notes

The importer already supports a few reusable metadata paths:

- `extractHikingAreaMetadata`
  - use when the source exposes `shape_area`
- `extractGeoJsonAreaM2Metadata`
  - use when a local or remote GeoJSON source exposes `area_m2`

Geometry normalization is also already built in:

- `MultiPolygon` becomes several stored polygon features
- `MultiLineString` becomes several stored line features

That means the source file does not need to be pre-flattened unless doing so makes the local `special://` snapshot easier to understand.

## Implementation Checklist

When adding or changing one curated special park:

1. Add or update the seed or direct config in [src/importer/special-parks/](../src/importer/special-parks), and touch [src/importer/import-special-parks.ts](../src/importer/import-special-parks.ts) only when the runtime import flow itself changes.
2. Add a local GeoJSON file under `src/importer/special-parks/data/` when the source should be stored as `special://...`.
3. Update [tests/integration/manual-catalog.integration.test.ts](../tests/integration/manual-catalog.integration.test.ts):
   - total import counts when the full curated list changes
   - park-specific assertions for the new row
4. Update [tests/fixtures/special-parks.ts](../tests/fixtures/special-parks.ts) only when the test source stays remote.
5. Prefer a focused test run first, then the full verification gate after review.

## Useful Commands

Import the full curated set:

```sh
npm run import:special-parks
```

Import only selected curated rows while iterating:

```sh
npm run import:special-parks -- <special-park-slug> [<special-park-slug> ...]
```

Run the focused integration test while working:

```sh
npm test -- tests/integration/manual-catalog.integration.test.ts
```

Run the full repo gate before handoff:

```sh
npm run verify
```
