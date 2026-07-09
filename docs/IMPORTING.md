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
