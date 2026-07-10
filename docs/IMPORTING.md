# Importing Guide

This repo has two import paths:

- `npm run import:parks` for the main LIPAS-backed catalog import
- `npm run import:special-parks` for curated non-LIPAS additions that still belong in the shared park catalog

Use this guide when you need to reproduce or extend the curated special import workflow.

## Entry Points

The normal special-import edit path is:

- [src/importer/import-special-parks.ts](../src/importer/import-special-parks.ts)
- [tests/integration/manual-catalog.integration.test.ts](../tests/integration/manual-catalog.integration.test.ts)
- [tests/fixtures/special-parks.ts](../tests/fixtures/special-parks.ts) when the source stays remote in tests
- `src/importer/data/<slug>.json` when the source should be stored locally as `special://...`

When a batch adds new curated special parks for the user, finish the implementation pass by offering a copy-pasteable one-liner import command that lists the new slugs explicitly, for example:

```bash
npm run import:special-parks -- slug-one slug-two slug-three
```

That lets the user run the import, review the resulting catalog rows locally, and only then give final acceptance for the verify/commit/push phase.

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

Helsinki is important enough that it is worth following a consistent path.

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

Typical Helsinki name filters:

- `puiston_nimi LIKE '%Tullisaari%'`
- `puiston_nimi LIKE '%Henrik Borgströmin puisto%'`
- `alueen_nimi LIKE '%Tuurholmanpuisto%'`

Practical Helsinki rule of thumb:

- use `YLRE_Viheralue_alue` when it already expresses the park as one or more official area polygons
- use `YLRE_Katu_ja_viherosat_eiliikenne_alue` only when the detailed sub-areas are genuinely the best published representation of the park

Example: `Tullisaaren kartanopuisto`

- the official published geometry was easier to justify from `YLRE_Viheralue_alue`
- the matching official park name in the source was `Henrik Borgströmin puisto`
- the stored user-facing import still remained `Tullisaaren kartanopuisto`
- the final stored geometry was copied into a repo-local `special://tullisaaren-kartanopuisto`

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

### 2. Luontoon destination polygons

Use this when Luontoon already exposes the place as a destination polygon.

- builder in code: `buildLuontoonGeoJsonCollectionSourceUrl`
- collection: `public.destinations_details_view`
- helper in code: `createLuontoonDestinationAreaConfig`
- metadata source: `surfaceArea`

This is a good fit when:

- the place has a clear Luontoon destination page
- the destination polygon already matches the intended imported place
- you want both official geometry and a Luontoon `parkUrl`

Examples in the importer include `Paistjärvi` and the later batch of Luontoon destination areas.

### 3. Luontoon route lines

Use this when the place should be imported as a route or nature trail and Luontoon has the route geometry.

- collection: `public.all_lines_details_view`
- source parser: `geojson`
- geometry note: `MultiLineString` is already normalized into several `LineString` features by the importer

Example pattern:

- `Torholan luola`

This is the cleanest option when the route already exists in Luontoon and the destination page itself is not the main geometry source.

### 4. Museovirasto protected sites WFS

Use this for the smaller set of curated history places that live under the Museovirasto protected-sites layer instead of RKY area polygons.

- builder in code: `buildMuseovirastoProtectedSitesSourceUrl`
- layer family: `muinaisjaannos_alue`
- helper in code: `createMuseovirastoSpecialParkConfig`

Examples include:

- `Harola`
- `Kajaanin linna`
- `Kuusiston linna`
- `Kärnäkosken linnoitus`

This is usually the right fit when the history place is already available as one named protected-site polygon.

### 5. Museovirasto RKY area workflow

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

Use this when:

- the user wants a specific public-facing end result name
- the official RKY title differs from that final imported name
- one RKY registry item returns more than one geometry candidate

Examples include:

- simple RKY additions like `Loviisan alakaupunki`, `Louhisaaren kartano`, `Sipoonlinna`, and `Iniön kirkonkylä`
- factory-village rows such as `Fiskarsin ruukki`, `Kauttuan ruukki`, and `Högforsin ruukki`, where feature narrowing or exclusions may be needed

### 6. World heritage WFS with feature ID filtering

Use this when the source is the Museovirasto world-heritage layer and the importer needs one exact feature from a broader dataset.

- parser in code: `world-heritage-area`
- filter field in code: `sourceFeatureId`

This pattern is already used for:

- `Merenkurkun maailmanperintöalue`
- `Sammallahdenmäki`
- `Suomenlinna`
- `Vanha Rauma`

This is useful when one shared WFS feed covers many world-heritage rows and the importer must select exactly one record.

### 7. Municipal ArcGIS route workflow

Use this when a municipality exposes a trail in ArcGIS FeatureServer form and Luontoon does not provide the right route geometry.

- builder in code: `buildArcGisGeoJsonQuerySourceUrl`
- source parser: `geojson`
- optional bounding envelope support is already built in

Examples include:

- `Paavolan luontopolku`
- `Santalahden luontopolku`

Use the envelope filter when:

- the service has many unrelated features
- the trail is easiest to isolate by a small bounding box instead of by attribute query alone

### 8. Repo-local `special://` geometry

Use this when the final stored geometry should live in the repo instead of being fetched live every test run.

- `special://<slug>` maps to `src/importer/data/<slug>.json`
- the importer loads these files directly from the repo
- `tests/fixtures/special-parks.ts` does not need an entry for local `special://` sources

This workflow is already used for several different reasons:

- copying a stable official geometry snapshot into the repo
- creating a pragmatic proxy polygon when the official source only validates a point
- storing a locally curated geometry that is easier to justify than a brittle remote endpoint

Examples include:

- Helsinki local geometries such as `Uutelan ulkoilualue`, `Kallahden ulkoilualue`, and `Tullisaaren kartanopuisto`
- island and boundary snapshots such as `Seurasaari`, `Mustikkamaa`, `Seili`, and `Vallisaari`
- pragmatic local proxies such as `Kuhakoski`

### 9. Geological SYKE GeoJSON workflow

Use this when the geometry comes from a non-protected-sites SYKE layer rather than the standard protected-sites WFS.

- builder in code: `buildSykeGeologicalRockAreaSourceUrl`
- source parser: `geojson`
- metadata source: `area_m2` when the layer exposes it in GeoJSON properties

Current example:

- `Rokokallio`

This is a good fit when the right official source is still SYKE, but it lives in a more specialized thematic layer.

## Geometry And Metadata Notes

The importer already supports a few reusable metadata paths:

- `extractHikingAreaMetadata`
  - use when the source exposes `shape_area`
- `extractLuontoonDestinationMetadata`
  - use when the source exposes `surfaceArea`
- `extractGeoJsonAreaM2Metadata`
  - use when a local or remote GeoJSON source exposes `area_m2`

Geometry normalization is also already built in:

- `MultiPolygon` becomes several stored polygon features
- `MultiLineString` becomes several stored line features

That means the source file does not need to be pre-flattened unless doing so makes the local `special://` snapshot easier to understand.

## Implementation Checklist

When adding or changing one curated special park:

1. Add or update the seed in [src/importer/import-special-parks.ts](../src/importer/import-special-parks.ts).
2. Add a local GeoJSON file under `src/importer/data/` when the source should be stored as `special://...`.
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
