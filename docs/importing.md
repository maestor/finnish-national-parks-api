# Importing Guide

This repo has three separate import paths:

- `npm run import:parks` for the main LIPAS-backed catalog import
- `npm run import:special-parks` for curated non-LIPAS additions that still belong in the shared park catalog
- `npm run import:osm-linked-trails` for the maintained catalog of explicitly linked trails
- `npm run import:osm-trails` for supplemental OpenStreetMap discovery

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

LIPAS imports create new records disabled. Manual special-park imports create new records visible. Both preserve existing visibility and editable fields. The LIPAS import retains supported source-active trails, then clips route lines against active stored area polygons in WGS84 and measures the resulting lengths in EPSG:3067. Each area covering at least 10% of measured route length qualifies independently, without a distance floor or buffer; comparison uses a 1e-7 ratio tolerance for projection and floating-point precision. Invalid polygons and wholly degenerate trails are reported without automatic matches. When a trail contains both usable and zero-length line parts, the usable parts are measured and the degenerate parts are flagged in the report and link metadata; no geometry is repaired. A trail without usable coordinates retains its last known bounds and marker; a new trail without usable coordinates uses a private zero-coordinate placeholder and cannot be enabled until coordinates exist. An area without usable coordinates fails the import. Both import paths fetch and validate their source batch before committing catalog or relationship changes. Special-import trails remain independent; special areas can be parents. An effective link hides a trail as a standalone destination, and removing the last match does not automatically republish it; an explicit enable restores independence only when no effective link remains. No visit records are moved or rewritten.

The LIPAS `route-length-km` property is stored as nullable `lengthKm` independently of the geometry measurements used for matching. Re-imports refresh the source value while preserving administrator edits, as with area. Existing rows receive their source length on the next LIPAS import after migration `0048_trail_length.sql`; missing values remain null.

### Link-only trails

Fitness trails (LIPAS type `4401`) use the existing walking-trail catalog type with an area-only flag. The regular LIPAS import includes them when the source is active and their geometry meets the overlap rule for at least one visible area. Automatic and manual links both require a visible parent. These trails appear in the parent’s linked-trail list and map. The flag blocks standalone publication even after unlinking. When the last qualifying visible parent is lost, the next import retires the trail and preserves historical visit assignments.

For a scoped import of link-only trails, back up the database and run `npm run import:parks -- --link-only-trails --dry-run`. Review the matches and affected parent slugs, then run `npm run import:parks -- --link-only-trails`. The scoped mode uses the stored area boundaries and leaves unrelated catalog records and links alone. Expire the reported URLs through the UI cache endpoint below for immediate updates.

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

To reduce traffic to remote libSQL, the main import upserts at most ten parks per statement, with a 1 MiB geometry budget per batch. Trail reconciliation loads geometry in groups of at most 50 records and 2 MiB. A single geometry larger than a budget is sent or read on its own. The import normalizes geometry before opening the write transaction. Periodic lightweight queries keep the remote transaction stream active during both link-only trail eligibility checks and trail reconciliation. All catalog writes, reconciliation and notification queuing remain in one transaction. Dry runs roll it back.

Back up the target database before applying. Run `npm run import:parks -- --dry-run` first. The dry run rolls back catalog changes and reports new rows, automatic links, exclusions, deactivations, in-place source transfers and affected public slugs. A trail with visits that would newly become a member aborts the transaction. See [the parent-area import workflow](#import-a-parent-area-for-a-trail-with-visits). After review, run `npm run import:parks` and immediately expire every reported slug through the UI's authenticated `POST /api/revalidate-public-cache` with `{ "parkSlugs": ["slug"] }` (maximum 500 per request). That endpoint also expires summary, map, planner and sitemap paths. API ETags do not invalidate the UI cache by themselves. Repeat the dry run to check stability before rollout.

A scheduled import rolls back when it would newly hide an enabled trail, because it cannot perform the UI's authenticated expiry. Review the reported slugs and run the manual import. If the LIPAS import moves a trail under a newly imported parent, enable the approved parent in the admin UI and immediately expire the parent and trail URLs. Special-area imports have the same cache guard. After review, run `npm run import:special-parks -- --allow-public-trail-conversions <slug>` for a single area and immediately expire that area and every reported trail URL. A newly imported special area is visible as soon as the transaction commits.

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

1. Confirm the area is visible in admin. Enable it if it already existed and was hidden.
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
same snapshot when the area bounds and source query are unchanged. A cache
expiry or a change to either input fetches a fresh snapshot. National-park
results appear first, followed by other areas.

The dry run lists trails that would be added or updated, their matched area names,
OSM relation IDs, measured lengths and review flags. It rejects nearby same-name
matches and routes whose sampled geometry is at least 90%
within 25 m of a stored trail or a longer selected OSM route. The geometric
screen is approximate and the report requires review. Local length and name
edits and manual link overrides survive refreshes. Missing source relations and
routes with no current area match are not withdrawn automatically. Automatic
links which cease matching on an otherwise eligible refreshed route are removed
or disabled while manual overrides remain.

The [Overpass index query](../src/importer/osm-trail-index.overpassql) defines
the source candidates and can exclude OSM relations with reviewed LIPAS
counterparts before snapshot creation. Existing catalog rows and area links
stay in the database.

After review and backup, run `npm run import:osm-trails` to import and immediately
use the UI's full cache clear to refresh the affected areas. An unchanged rerun does not
write catalog records. The public linked-trail representation identifies its
OSM relation and carries attribution and the ODbL licence URL. Source data is
© OpenStreetMap contributors, available under the Open Database License:
https://www.openstreetmap.org/copyright. Retain the source snapshot and review
ODbL obligations for public distribution of the resulting database before
publishing imported data.

### Selected linked trails

The linked-trail importer reads one catalog from
[src/importer/osm-linked-trails.geojson](../src/importer/osm-linked-trails.geojson).
Each entry pins geometry from reviewed OSM relation members or ways and links
the trail to its parent area. Luontoon URLs are visitor references.

On production, merge and let the `Production Migration` workflow apply pending
schema changes before API promotion. From the deployed API checkout, set
`DATABASE_URL` and, for Turso, `DATABASE_AUTH_TOKEN` for the intended database.
Take a fresh backup, preview the import, then apply the reviewed result from the
same checkout:

```sh
npm run db:backup -- before-osm-linked-trails
npm run import:osm-linked-trails -- --dry-run
npm run import:osm-linked-trails -- --json
```

Preview and apply output list only added or updated trails. A text run with
zero changes prints `No changes needed.` and the JSON report has an empty
`selections` array. Use `--dry-run --json` to inspect source identities,
geometry hashes, distant namesakes, and affected cache slugs before applying.
The importer checks for pending migrations. It resolves existing OSM trails by
relation ID, preserves their IDs, existing visit assignments and administrator
name and length edits, and writes the reviewed batch in a single transaction.
New rows appear under their linked parents. Nearby same-name trails, administrator
link exclusions, merged sources, and standalone trails with direct visits
require review before the batch can apply. The name check applies when a
selection is first imported. Compare complete route geometry with existing
LIPAS trails during review to catch matches with different names. An
unchanged rerun writes nothing.

After applying, expire every reported `affectedSlugs` entry through the [authenticated
cache-clear workflow](#trailarea-reconciliation), then check the public park pages.
The preview's hashes and the apply output identify the reviewed catalog version.

#### Add a trail or edit an entry before its first import

1. Download the OSM relation or selected ways and check the route on a map
   against its intended start, finish, and branches. Use a Luontoon URL only as an
   optional visitor reference. Record the OSM identity, snapshot timestamp, and
   any choice to omit or include particular member ways.
2. Add or edit the entry in `selections` and its ordered LineString geometry in
   `features`. Use the same stable `selectionKey` on the entry and every feature.
   Set the existing park's `parentSlug`. Record the nominal walking distance
   separately from the measured mapped line length.
3. Set `featureCount` and `geometrySha256` for that entry. This helper prints both
   values from the ordered features. Pass the relevant selection key as its
   argument.

   ```sh
   node --input-type=module - osm-relation-1633747 <<'JS'
   import { createHash } from 'node:crypto';
   import { readFileSync } from 'node:fs';
   const catalog = JSON.parse(readFileSync('src/importer/osm-linked-trails.geojson', 'utf8'));
   const geometries = catalog.features
     .filter(({ properties }) => properties.selectionKey === process.argv[2])
     .map(({ geometry }) => ({ coordinates: geometry.coordinates, type: geometry.type }));
   if (!geometries.length) throw new Error('No features for that selection key');
   console.log({
     featureCount: geometries.length,
     geometrySha256: createHash('sha256').update(JSON.stringify(geometries)).digest('hex')
   });
   JS
   ```

4. Run `npm run import:osm-linked-trails -- --dry-run --json`. Check the source
   IDs, trail identity, parent and affected slugs against the intended change.
   Use the backup, apply and cache refresh sequence above.

#### Correct a trail that has already been imported

An administrator can edit the trail's displayed name and length. The importer
preserves those edits. For a geometry, source, or parent correction, keep the
selection key and trail ID. The importer stops with `Selected source drift` or
`Stored geometry drift` when an already accepted snapshot differs from the
stored one.

Prepare a reviewed, transactional correction alongside the catalog edit. On a
backup copy, verify the current source identity and old geometry hash, update
the trail and its curated source record together, and review the affected park
links and visit assignments. For a parent change, check whether visits pin the
old membership before removing it. Rehearse the correction and rerun the
importer on that copy. The corrected entry should produce no further changes.
This catalog importer handles additions and adoption of uncurated relation
rows. A correction to an accepted snapshot needs that separate reviewed write.

Regular LIPAS and OSM imports preserve pinned memberships and accepted geometry.
Catalog additions use the existing database schema.

### Merged OSM trail refresh

Maintainers can [merge linked OSM trails manually](development.md#merge-linked-trails). Original relation identities and raw component snapshots remain separate from the destination's combined geometry. The public linked-trail `source.relations` array lists every contributing relation ID and URL; existing singular `relationId`/`sourceUrl` fields still identify the destination's primary source.

Known merge members refresh before duplicate/containment filtering. The importer rebuilds each changed destination once from current valid components, preserving its chosen name, slug, administrator length correction and manual memberships. Absorbed sources stay inactive and hidden; database guards also prevent re-enabling them. A missing or rejected member keeps its last valid component and is reported, while valid members can still refresh. Invalid combined geometry or concurrent edits abort the transaction instead of partly replacing snapshots. Normal reads remain local-first. An unchanged rerun writes nothing.

New automatic area matches use combined geometry and are included in the affected cache slugs. Previously pinned memberships survive geometry changes. After import, immediately clear the UI's public caches as above; API data-version updates do not expire them. LIPAS area imports and long-trail retirement retain source identities and merge membership. Source snapshots cannot be treated as a reversible edit history: there is no automatic unmerge.

## Production imports after merges

The API repository's **Production Migration** workflow compares the previous
and current `main` commits after a merge, including squash merges. The
catalog import job runs after the schema check and uses the existing
`production` database secrets. It takes one backup before running the selected
imports. The workflow queues production database jobs serially alongside the
weekly LIPAS workflow.

| Change merged to `main` | Import |
| --- | --- |
| A special-park definition or its `special://` geometry changes | `npm run import:special-parks -- <affected-slugs...>` |
| A selection changes in `osm-linked-trails.geojson` | `npm run import:osm-linked-trails -- --selection <key>` for the affected keys in one batch |
| A PR sets or changes the nonempty file `.github/osm-trails-refresh` | `npm run import:osm-trails` |

Special parks run first so new parent areas exist when curated trails are
linked. Routine merges with no catalog changes skip the import and backup
steps. Removed definitions appear in the workflow summary for manual review.
An older run skips changes superseded by a newer merge.
Existing selected-trail drift protections still apply. Automatic imports stop
for conversions that would hide a public standalone trail and require
immediate cache expiry.

Supplemental OSM discovery reads live OpenStreetMap data across all active
areas. To request it in a PR, put a new nonempty value such as an issue number
and short refresh reason in `.github/osm-trails-refresh`. For an on-demand run,
open **Actions → Production Migration → Run workflow**, select `main`, and
enable **Refresh supplemental OpenStreetMap trails**.

After a successful run, expire the affected park caches through the
[authenticated cache workflow](#trailarea-reconciliation). The Actions summary
reports the scoped special-park slugs and the trail import reports.
For a failed run, review the error and the backup artifact before retrying.
Existing catalog changes can be applied manually from `main` with the commands
above. Repeat `--selection <key>` to include multiple curated trails, and add
`--dry-run --json` to preview the selection.

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
applies migrations itself. Wait for Production Migration to finish before
starting a manual workflow dispatch. It must apply `0053_area_link_only_trails.sql`
before the first link-only trail import.

The workflow opens one Finnish issue, mentioning only `@maestor`, when it adds
new standalone destinations, new automatic links for link-only trails, or
incoming LIPAS trails skipped because of an existing match.
The enable instructions apply to the standalone destinations section. The
linked trails section lists each new link as “Trail on liitetty kohteeseen Area”.

For a new LIPAS trail ID, the scheduled import compares its route to nearby
active trails already in the catalog, including earlier LIPAS imports still
present in the feed. It skips the new row if at least 95% of each route is
within 25 m of the other. Coverage uses length-weighted samples at intervals
of up to 10 m in EPSG:3067. A shorter loop can pass the check when the reverse
coverage is below 95%. The issue lists the skipped LIPAS ID, the matching
trail and its source, and any linked area names. The import checks again each
week, so a trail can be added if the existing match retires. A skipped trail
can appear again in a later weekly report. Manual imports still let an operator
add a reviewed LIPAS trail.

The job log prints a `parkSlugs` payload for immediate expiry of affected pages
through the UI endpoint above. Area detail caches refresh on their normal
one-hour cycle.

Existing parks are refreshed using the same import and preservation rules as
the manual command. Missing LIPAS-managed parks become inactive. Normal API
reads remain local-first. Use the manual workflow above for public trail
conversions that require immediate cache expiry.

If a database statement loses its HTTP socket (`UND_ERR_SOCKET`), the workflow
retries the full catalog import once after the failed attempt exits. A socket
failure during commit fails the run because the database may have committed it.

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
