# Finnish National Parks API

A local-first TypeScript API for Finnish park and outdoor-area catalog data and personal visit tracking.

The API imports selected park and outdoor-area data from the open LIPAS API into an owned SQLite/libSQL database, then serves it for a future personal map application where places can have notes and visit history.

## Goals

- Keep a small, reliable park catalog in an owned database.
- Use LIPAS as the machine-readable source for place names, locations, boundaries, area, establishment year, and Luontoon links.
- Use Luontoon only as an official external reference link.
- Store personal notes and visit history separately from imported catalog data.
- Start locally with SQLite/libSQL and target Turso on Vercel for deployment.
- Keep imported catalog data heavily cached and never fetch LIPAS during normal API reads.

## Stack

- Node.js 24 and TypeScript.
- Hono for HTTP routing.
- Zod and OpenAPI for API contracts.
- Drizzle ORM with `@libsql/client`.
- Local database default: `DATABASE_URL=file:./data/local.db`.
- Production database target: Turso.
- Deployment target: Vercel Functions.
- Vercel entrypoint: `src/index.ts` with a direct `hono` import for Vercel auto-detection.
- Keep direct `hono` imports out of non-entry modules such as `src/app.ts`, because Vercel can mis-detect those files as the deployment entrypoint and crash boot with an invalid default export.
- Local long-running server entrypoint: `src/local-server.ts`.

## Setup

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run import:parks
npm run import:special-parks
npm run import:special-parks -- <special-park-slug> [<special-park-slug> ...]
npm run park:move-visits -- --from <source-slug> --to <target-slug> [--dry-run]
npm run park:logo -- <park-slug>
npm run db:backup
npm run verify
npm run dev
```

Environment variables are optional for local development — sensible defaults are built in. Copy `.env.example` to `.env` if you want to customize anything:

```sh
cp .env.example .env
```

Key variables:

```sh
DATABASE_URL=file:./data/local.db
DATABASE_AUTH_TOKEN=
API_KEY=your-local-dev-key

# Optional: enable Google OAuth login for the control panel
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
AUTH_JWT_SECRET=change-me-to-a-long-random-string
FRONTEND_URL=http://localhost:4300

# Optional: enable the backend trip planner with Geoapify geocoding + routing
GEOAPIFY_API_KEY=

# Optional: Cloudflare R2 storage for visit images and park logos
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

Production notes:

- Vercel deployments must set `DATABASE_URL` to a remote `libsql://...` database instead of the local file default.
- Vercel deployments should always set `API_KEY`, because every `/api/*` endpoint is bearer-protected outside localhost today.
- If Google OAuth is enabled in Vercel, `FRONTEND_URL` must be the deployed frontend origin.
- If Google calls the API directly, Google must allow `https://your-api-domain.vercel.app/auth/google/callback`.
- If `/auth/*` is exposed through a frontend proxy or rewrite, set `GOOGLE_REDIRECT_URI=https://your-frontend-domain/auth/google/callback`, register that exact URI in Google Cloud, and start the login flow through that same public domain so the OAuth cookies stay on the right host.
- `GEOAPIFY_API_KEY` enables `POST /api/trip-planner/suggestions`, `POST /api/trip-planner/search`, and `POST /api/trip-planner/nearby`. Keep it server-side only; the UI should call the backend through its existing server proxy layer.
- `MEMORY_STORAGE=true` is for tests and local-only development, not Vercel.
- Production merges to `main` should run the GitHub Actions `Production Migration` workflow against Turso before Vercel promotes the new production build.
- Store production `DATABASE_URL` and `DATABASE_AUTH_TOKEN` in the GitHub `production` environment for that workflow, and configure Vercel Deployment Checks to require the GitHub check named `Migrate production database`.
- That workflow now checks production first and only takes a backup plus runs `npm run db:migrate` when unapplied SQL migration files actually exist.
- `npm run db:backup` reads the current remote `DATABASE_URL` and `DATABASE_AUTH_TOKEN`, then writes a timestamped SQLite backup under `data/backups/`. You can append an optional label with `npm run db:backup -- before-import`.
- `npm run db:migrate` remains available as the manual fallback or recovery path if the production workflow is unavailable.
- `npm run park:move-visits -- --from <source-slug> --to <target-slug> [--dry-run]` reassigns all visits for one park slug to another. Visit images stay attached automatically because they belong to the visit rows.
- `npm run park:logo -- <park-slug>` uploads either `data/logos/<park-slug>.png` or, when multiple parks share one `displayTypeName`, `data/logos/display-types/<normalized-display-type>.png`. Shared display-type logos are stored once under `logos/display-types/` in R2 and linked from every matching park row. Park APIs currently expose presigned logo URLs instead of a configurable public base URL.

The importer's LIPAS source URL and supported type-code list are internal configuration, not a normal `.env` setting.

## API Shape

- `GET /health`
- `GET /openapi.json`
- `GET /api/parks`
- `GET /api/parks/search`
- `GET /api/admin/parks/visibility`
- `GET /api/parks/:slug`
- `PATCH /api/parks/:slug`
- `GET /api/home-summary`
- `GET /api/map-summary`
- `GET /api/trips`
- `GET /api/visits-timeline`
- `POST /api/trip-planner/suggestions`
- `POST /api/trip-planner/search`
- `POST /api/trip-planner/nearby`
- `GET /api/parks/:slug/visits`
- `POST /api/parks/:slug/visits`
- `PATCH /api/parks/:slug/removed`
- `GET /api/visits`
- `GET /api/visits/:id`
- `POST /api/trips`
- `PATCH /api/trips/:id`
- `DELETE /api/trips/:id`
- `PATCH /api/visits/:id`
- `DELETE /api/visits/:id`
- `POST /api/visits/:id/images/upload-url`
- `POST /api/visits/:id/images/complete`
- `POST /api/visits/:id/images`
- `DELETE /api/visits/:visitId/images/:imageId`
- `PATCH /api/visits/:id/images/reorder`

Auth endpoints for control-panel login:

- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/me`
- `POST /auth/logout`

Catalog endpoints stay cache-friendly and database-backed:

- `GET /api/parks` returns lightweight list data without boundary GeoJSON.
- `GET /api/parks/search` returns an even smaller visible-park payload for autocomplete and other text-search UIs.
- `GET /api/admin/parks/visibility` returns lightweight visible and removed park arrays in one admin-session-protected response for admin visibility management.
- `GET /api/parks?type=hiking-area` filters by normalized type slug.
- `GET /api/parks?category=hiking-and-wilderness-areas` combines `hiking-area` and `wilderness-area` under the public category `Erämaa-/retkeilyalue` while preserving each park's source `type`.
- `GET /api/parks?category=trails-and-routes` filters by a derived API category while park responses still preserve the original imported `type`.
- `GET /api/parks/:slug?includeBoundary=true` includes stored boundary geometry.
- `GET /api/parks/:slug` still returns `404` for removed parks publicly, but when a valid admin session cookie is present it also serves removed-park detail for control-panel workflows.
- Park list, detail, removed, and map summary responses include both the source `type` and a derived `category`.
- Park list, detail, removed, and map summary responses include `logo: { key, updatedAt, url } | null` when a logo has been linked to the park.
- Park responses expose raw `locationLabel`, `postalCode`, and `postalOffice` fields from the database, plus a derived `address` string for display use.
- `GET /api/home-summary` returns cache-friendly home-page visit totals, seasonal visit counts, type progress with a `visible` flag, category progress, recent activity, and a visit-data `version` / `updatedAt` signal without notes, routes, or images.
- `GET /api/map-summary` returns cache-friendly park map data plus per-park visited summaries and the same visit data version signal.
- `GET /api/trips` returns named trips with derived `dateRange`, `visitCount`, and the same visit-data version-backed cache behavior as the other public summary endpoints.
- `GET /api/visits-timeline` returns the lightweight timeline dataset for `/kaynnit`, with each visit including `id`, `visitedOn`, `createdAt`, `route`, `imageCount`, `trip: { id, name } | null`, `tripStopOrder: number | null`, and a resolved park `typeLabel`. When two visits belong to the same trip on the same day, the timeline uses `tripStopOrder` instead of falling back to entry creation time.
- `POST /api/trip-planner/suggestions` returns up to three Geoapify-backed place suggestions with labels and coordinates for origin/destination pickers.
- `POST /api/trip-planner/search` geocodes origin and destination server-side, fetches a real driving route from Geoapify, and returns visible catalog parks within a route corridor using stored park geometry plus visited summaries, route `LineString` geometry, backend-provided route and park bounding boxes for map rendering, and top-level `maxDistanceKm` / `defaultDistanceKm` filter metadata. On longer trips, the first 30 km from the origin is treated as a stricter start zone so dense departure-area clusters do not dominate the results.
- `POST /api/trip-planner/nearby` geocodes only the origin server-side, filters visible catalog parks by straight-line proximity to that point, and returns visited summaries plus a backend-provided `searchArea` bounding box and top-level `maxDistanceKm` / `defaultDistanceKm` filter metadata for map rendering without route geometry.
- Trip planner results are ordered with unvisited parks first, then route-aware proximity; on longer trips, later-route matches are favored ahead of remaining start-zone matches within the same result group.
- `GET /api/parks/:slug/visits` returns visit history plus a visited summary for one park.
- `GET /api/visits` returns flat visit resources with their parent park reference, `trip: { id, name } | null`, and `tripStopOrder: number | null`.
- `GET /api/visits/:id` returns one visit with its parent park reference, `trip: { id, name } | null`, and `tripStopOrder: number | null`.
- Catalog, home summary, map summary, trip list, and visits timeline `GET` endpoints emit deterministic `ETag` headers and support `304 Not Modified`.
- Home summary, map summary, trip list, and visits timeline endpoints use `Cache-Control: public, max-age=0, s-maxage=600`.
- Their visit-data version signal bumps when visit data changes, including trip create/update/delete, visit create/update/delete, and visit image upload/delete/reorder.
- Visit and management endpoints use `Cache-Control: private, no-store`.
- Trip planner suggestion, route-search, and nearby-origin responses also use `Cache-Control: private, no-store`.
- All write routes and `GET /api/admin/parks/visibility` require a valid admin session cookie.
- `PATCH /api/parks/:slug` updates the admin-editable park fields (`name`, `slug`, `locationLabel`, `postalOffice`, `postalCode`, `areaKm2`, `establishmentYear`, `parkUrl`, `displayTypeName`) and auto-generates a slug from `name` when `slug` is omitted.
- `PATCH /api/parks/:slug/removed` lets the admin UI hide or restore a park by toggling its persisted `removed` flag.
- `POST /api/trips`, `PATCH /api/trips/:id`, and `DELETE /api/trips/:id` are admin-session write routes for named trip management.
- `POST /api/parks/:slug/visits`, `PATCH /api/visits/:id`, and `DELETE /api/visits/:id` are admin-session write routes for owned visit data. Visit create/update accepts `tripId`, with `null` clearing an assignment, plus optional `tripStopOrder` for explicit within-trip stop sequencing.
- Deployed clients should use the two-step direct upload flow: `POST /api/visits/:id/images/upload-url`, upload the file to R2 with the returned `PUT` URL, then call `POST /api/visits/:id/images/complete`.
- `POST /api/visits/:id/images`, `DELETE /api/visits/:visitId/images/:imageId`, and `PATCH /api/visits/:id/images/reorder` are also admin-session write routes.
- `POST /api/visits/:id/images` remains available for localhost-style server uploads, but Vercel runtime disables that Sharp-based path so uploads do not pass through the function body limit.
- `GET /health` and `GET /openapi.json` are the only anonymous data endpoints today.
- `/auth/*` routes are anonymous login-control endpoints, not public data endpoints.
- There are no anonymous site data endpoints in this API. Frontend-facing `GET` routes such as `/api/home-summary`, `/api/map-summary`, `/api/trips`, and `/api/visits-timeline` still require the API key outside localhost when `API_KEY` is configured.

## Data Source

The catalog importer should use:

```text
https://api.lipas.fi/v2/sports-sites?type-codes=103,109,110,111,112,4403,4404,4405&page-size=100&page=1
```

Importer expectations:

- Keep only `status === "active"` records.
- Expect 2557 active LIPAS records in the current source dataset.
- Import these supported LIPAS catalog types:
  - `103` Ulkoilu-/virkistysalue
  - `109` Valtion retkeilyalue
  - `110` Erämaa-alue
  - `111` Kansallispuisto
  - `112` Muu luonnonsuojelualue
  - `4403` Ulkoilureitti
  - `4404` Luontopolku
  - `4405` Retkeilyreitti
- Store normalized type metadata in a dedicated type table and reference it from catalog rows.
- Store catalog fields needed for a map app.
- Persist both `postalCode` and `postalOffice` from LIPAS so location matching can use the more stable numeric postal identifier.
- Skip `4404` nature trails and `4405` hiking trails when their full route geometry is contained inside one imported area record, because visits should attach to the parent area instead of the nested route.
- Skip `4403` walking trails when any route point overlaps an imported area record, because those routes are treated as nested visit targets even when only part of the route crosses the area.
- Skip trail imports whose normalized `locationLabel`, `postalCode`, and `postalOffice` exactly match one imported area record, because those are also treated as nested visit targets.
- Import `4403` walking trails and `4405` hiking trails as removed-by-default catalog rows so the UI can opt into showing them separately from the main public catalog.
- Exclude LIPAS contact email, phone number, and comment text.
- Refresh imported `parkUrl` values from Luontoon's official Finnish sitemap when a matching destination exists, instead of trusting LIPAS `www` blindly.
- Preserve personal notes and visit history across imports.
- Preserve manual park removals across imports and exclude removed rows from API responses.
- Preserve manual edits to the editable park fields across imports by storing the latest imported baseline separately from the current admin-managed values.
- Allow manually imported catalog rows, such as Merenkurkun maailmanperintöalue, to stay active outside the normal LIPAS cleanup path.
- Read from the local/libSQL database during normal API requests instead of calling LIPAS live.

The supported manual catalog import currently covers:

```sh
npm run import:special-parks
```

It imports curated non-LIPAS catalog rows such as Merenkurkun maailmanperintöalue, Sammallahdenmäki, Suomenlinna, Vanha Rauma, Paistjärvi, Uutelan ulkoilualue, Kallahden ulkoilualue, Seurasaari, Mustikkamaa, Tullisaaren kartanopuisto, and selected cultural-history areas, keeps their source geometry, preserves custom display labels such as `Maailmanperintökohde` and `Tehdaskylä`, and protects those rows from later LIPAS deactivation.

For the reproducible workflow for special imports, including Helsinki WFS sourcing, see [docs/importing.md](docs/importing.md).

For faster local iteration, you can import only selected special parks by slug:

```sh
npm run import:special-parks -- loviisan-alakaupunki turunmaan-kalkkilouhokset
```

## Verification

The main quality gate is:

```sh
npm run verify
```

It runs typecheck, lint, and coverage tests with 100 percent thresholds for first-party application code. The lint step fails on any Biome diagnostics, including config info and warning-level findings. This must pass before any change is considered ready, unless the change is entirely outside what `verify` validates — for example, pure documentation updates.

## Documentation

- [AGENTS.md](AGENTS.md): codebase rules for future agents and implementation sessions.
- [docs/development.md](docs/development.md): local development, database, importer, and deployment notes.
- [docs/importing.md](docs/importing.md): reproducible import workflow for curated special parks, including Helsinki-specific sourcing tips.
- [docs/security.md](docs/security.md): current security and operational sustainability priorities, plus contributor guardrails.
- [docs/testing.md](docs/testing.md): testing strategy and verification expectations.
- [docs/trip-planner.md](docs/trip-planner.md): trip planner endpoints, route-corridor definitions, and long-trip start-zone logic.
