# Development Notes

## Local Workflow

Current local workflow:

```sh
npm install
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

`npm run dev` and `npm run start` use the local Node server entrypoint at `src/local-server.ts`.
The Vercel deployment entrypoint is `src/index.ts`, which default-exports the Hono app and keeps a direct `hono` import so Vercel can auto-detect the project as Hono.
Do not add direct `hono` imports to `src/app.ts` or other non-entry modules just for types or helpers. Vercel can mis-detect those files as the entrypoint, then fail deployment because they do not default-export the runnable server.
The deployment guardrail test for this lives in `tests/integration/vercel-entry.integration.test.ts`. Keep it updated whenever the runtime entry shape changes.

## Runtime Requirements

- Node.js 24 or newer.

## Security And Sustainability Baseline

- Route naming is not the auth policy. `/api/public/*` names frontend-facing payloads, not anonymous access.
- Do not expose the shared `API_KEY` in browser-delivered code.
- All write routes and `GET /api/admin/parks/visibility` should stay admin-session protected.
- When adding or changing an env var, update `src/env.ts`, `.env.example`, `README.md`, and the relevant docs in the same change.
- Treat direct uploads as a storage-cost surface: enforce size and content-type limits against the actual stored object, not only the client request.
- Prefer owned data and cached verification over new live third-party request-path dependencies.
- Before risky imports, migrations, or large manual catalog updates against Turso, take a fresh `npm run db:backup`.
- Keep the current hardening priorities in [docs/security.md](./security.md).

## Branch And PR Workflow

- Create a dedicated branch for every change: `feature/<name>`, `bugfix/<name>`, `chore/<name>`, `docs/<name>`, etc.
- If you are currently on `main`, create or switch to the correct work branch before editing files, running write-capable fixers, or staging changes.
- After the review pause, treat a brief approval such as `done`, `looks good`, or `approved` as permission to continue the remaining PR-ready workflow steps unless the user explicitly asks to stop before verify, commit, or push.
- Push the branch and open a pull request against `main`.
- Ensure `npm run verify` passes locally before requesting review.
- User review and explicit acceptance are required before merging.
- Do not push directly to `main`.

## Environment

Copy `.env.example` to `.env` and adjust as needed:

```sh
cp .env.example .env
```

The `.env` file is loaded automatically on startup — no manual `export` needed.

Available variables:

```sh
API_KEY=your-local-dev-key
DATABASE_URL=file:./data/local.db
DATABASE_AUTH_TOKEN=
PORT=3004

# Google OAuth (optional — only needed for control-panel login)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
AUTH_JWT_SECRET=change-me-to-a-long-random-string
AUTH_COOKIE_NAME=__session
FRONTEND_URL=http://localhost:4300

# Geoapify trip planner (optional — only needed when testing the route planner backend)
GEOAPIFY_API_KEY=

# Cloudflare R2 (optional — needed for visit image uploads and park logo uploads)
# Visit images and park logos use presigned URLs today, so the bucket can stay private.
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
MEMORY_STORAGE=false
```

All variables are optional for local development — sensible defaults are built in. `API_KEY` is only required if you want to test authenticated access locally; localhost requests bypass auth even when it is set.
The importer's LIPAS source URL and supported type-code list are internal configuration rather than `.env` settings.

OAuth routes (`/auth/*`) are only registered when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_JWT_SECRET` are all provided.
`GOOGLE_REDIRECT_URI` is optional and only needed when the public OAuth callback is exposed through a frontend proxy or rewrite instead of the API domain itself.
`POST /api/trip-planner/suggestions`, `POST /api/trip-planner/search`, and `POST /api/trip-planner/nearby` are available whenever the app boots with a database, but all three return `503` until `GEOAPIFY_API_KEY` is configured.
Keep `GEOAPIFY_API_KEY` server-side only. The browser-facing UI should go through the frontend server proxy and the existing backend API-key boundary.
For the current trip-planner search heuristics, start-zone behavior, and tuning definitions, see [docs/trip-planner.md](./trip-planner.md).

Turso/Vercel deployment variables should use the same names where possible:

```sh
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

Vercel guardrails in this repo:

- `API_KEY` is required on Vercel so API routes are not exposed accidentally.
- `DATABASE_URL` cannot use the local `file:` default on Vercel.
- `MEMORY_STORAGE=true` is rejected on Vercel because it is ephemeral.
- If Google OAuth is enabled on Vercel, `FRONTEND_URL` cannot point at localhost.
- If `GOOGLE_REDIRECT_URI` is set on Vercel, it cannot point at localhost.

The local SQLite/libSQL file and `.env` itself should not be committed.

## Importer Workflow

The importer should:

- Fetch LIPAS sports sites with type codes `103,109,110,111,112,4403,4404,4405`.
- Keep only records where `status` is `active`.
- Expect 2557 active LIPAS records from the current source dataset.
- Upsert catalog rows by `lipasId`.
- Upsert normalized catalog types in a dedicated `park_types` table.
- Persist both `postal_code` and `postal_office` from LIPAS for stronger location matching.
- Skip `4404` nature trails and `4405` hiking trails whose full route geometry is contained inside one imported area record.
- Skip `4403` walking trails when any route point overlaps one imported area record.
- Skip trail imports whose normalized `location_label`, `postal_code`, and `postal_office` exactly match one imported area record.
- Import `4403` walking trails and `4405` hiking trails as removed-by-default catalog rows.
- Preserve personal visit history during catalog re-imports.
- Preserve any manually set `parks.removed` flags during catalog re-imports.
- Preserve admin-managed edits to `name`, `slug`, `location_label`, `postal_office`, `postal_code`, `area_km2`, `establishment_year`, `park_url`, and `display_type_name` during catalog re-imports while still refreshing the imported baseline for those fields.
- Refresh destination `parkUrl` values from `https://www.luontoon.fi/resources/sitemap/fi.xml` when the official sitemap contains a matching base destination URL.
- Derive slug, marker point, and bounding box from imported data.
- Store boundary GeoJSON for detail/map-boundary usage.
- Exclude contact email, phone number, and comment text.
- Update import metadata so catalog ETags change when imported catalog data changes.
- Keep non-LIPAS-managed catalog rows outside the normal LIPAS deactivation pass.

The current implementation fails the import if the active LIPAS record count does not match `2557`, so upstream drift is visible immediately.
If a destination cannot be matched from the official Luontoon sitemap, the importer falls back to the normalized LIPAS `www` value for that row.

### Manual Catalog Imports

This repo also supports curated special imports for non-LIPAS parks:

```sh
npm run import:special-parks
```

That command:

- imports curated official geometry into the existing `parks` table
- stores curated rows under the same normalized catalog types used elsewhere in the API, including curated display labels where needed
- marks the rows as not managed by the LIPAS cleanup step, so later `npm run import:parks` executions do not deactivate them

For faster local iteration when adding only a few curated parks, pass one or more special-park slugs after `--`:

```sh
npm run import:special-parks -- loviisan-alakaupunki turunmaan-kalkkilouhokset
```

For the reproducible contributor workflow for curated special imports, source-family selection, and when to prefer local `special://...` GeoJSON, see [docs/importing.md](./importing.md).

### Park Logos

Downloaded source logo PNG files can live under `data/logos/` and stay local because the repository ignores `data/`.

To attach one logo to one existing park row:

```sh
npm run park:logo -- <park-slug>
```

That command:

- loads the current `.env` automatically
- uses `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to target either local SQLite or remote Turso
- first looks for a park-specific `data/logos/<park-slug>.png`
- if no park-specific file exists and the park has a `displayTypeName`, falls back to `data/logos/display-types/<normalized-display-type>.png`
- uploads park-specific files to `logos/<park-slug>.png`
- uploads shared display-type files once to `logos/display-types/<normalized-display-type>.png` and then reuses that same key for every matching park
- stores the logo key plus a logo timestamp on the matching park row so catalog ETags and logo URLs change together

Catalog APIs currently return presigned logo URLs instead of a configurable public base URL.

## Database

The repository owns the database schema through:

- [src/db/schema.ts](../src/db/schema.ts)
- [src/db/migrations/0000_init.sql](../src/db/migrations/0000_init.sql)

Current table groups:

- catalog types
- imported park catalog rows
- personal visit records
- visit images
- import run metadata
- admin allowlist (`admins`)

Personal data must not be removed by catalog synchronization.
Catalog rows marked with `parks.removed = 1` are intentionally hidden from park APIs and should stay removed across future imports.

### Admin Allowlist

The `admins` table stores allowed Google email addresses for control-panel access. It contains only `email`, `created_at`, and `updated_at` — no Google IDs, names, or pictures are persisted.

Add an admin manually:

```sh
sqlite3 data/local.db "INSERT INTO admins (email, created_at, updated_at) VALUES ('admin@example.com', datetime('now'), datetime('now'));"
```

Local development should use a file database. Production should target Turso with the same Drizzle schema and libSQL client path.

### Turso Backup Workflow

When `.env` points `DATABASE_URL` at a remote Turso/libSQL database and includes `DATABASE_AUTH_TOKEN`, you can pull a local backup into this workspace with:

```sh
npm run db:backup
```

Backups are written to `data/backups/` with a timestamped filename and are not committed because the repo already ignores `data/`.

You can append a short label when you want to mark why the backup was taken:

```sh
npm run db:backup -- before-import
```

## API Contract

The API uses Zod schemas as the contract source of truth with OpenAPI exposed at `GET /openapi.json`.

Key route behavior:

- `GET /api/parks` is optimized for map/list views and omits boundary geometry.
- `GET /api/parks/search` returns a minimal visible-park payload for search and autocomplete flows.
- `GET /api/admin/parks/visibility` returns lightweight visible and removed park arrays in one private admin response for admin visibility tooling.
- `GET /api/parks?type=hiking-area` filters by normalized catalog type slug.
- `GET /api/parks?category=hiking-and-wilderness-areas` filters by the derived `Erämaa-/retkeilyalue` category while preserving each park's imported `type`.
- `GET /api/parks?category=trails-and-routes` filters by a derived API category while preserving the original imported `type` in responses.
- `GET /api/parks/:slug?includeBoundary=true` returns the stored boundary GeoJSON.
- `GET /api/parks/:slug` still hides removed parks publicly, but returns removed-park detail to a request carrying a valid admin session cookie when OAuth is enabled.
- Park list, detail, removed, and public map responses expose both the source `type` and a derived `category`.
- Park list, detail, removed, and public map responses expose `logo: { key, updatedAt, url } | null` when one has been linked to the park.
- Park responses expose raw `locationLabel`, `postalCode`, and `postalOffice` fields from the database, plus a derived `address` string for display use.
- `GET /api/public/home-summary` returns frontend-public home-page summary data including seasonal visit counts, `progressByType` with a `visible` flag, and `progressByCategory`, without visit notes, routes, or images.
- `GET /api/public/map-summary` returns lightweight frontend-public park map data plus per-park visited summaries.
- `POST /api/trip-planner/suggestions` returns up to three Geoapify-backed place suggestions with labels and coordinates for origin/destination selection.
- `POST /api/trip-planner/search` geocodes origin and destination, fetches a real Geoapify driving route, filters visible parks by a configurable corridor distance, and returns list-ready results with visited summaries plus a map-ready route `LineString`, backend-provided route and park bounding boxes, and top-level `maxDistanceKm` / `defaultDistanceKm` filter metadata. On longer trips, the first 30 km from the origin uses a stricter start-zone filter so dense departure areas do not flood the list.
- `POST /api/trip-planner/nearby` geocodes only the origin, filters visible parks by straight-line proximity to that point, and returns list-ready results with visited summaries plus a backend-provided `searchArea` bounding box and top-level `maxDistanceKm` / `defaultDistanceKm` filter metadata for map rendering without route geometry.
- `GET /api/parks/:slug/visits` returns visit history plus a visited summary for one visible park.
- `GET /api/visits` returns flat visit resources with their parent park reference.
- `GET /api/visits/:id` returns one visit with its parent park reference.
- Catalog and public summary routes emit deterministic `ETag` headers and support `304 Not Modified`.
- Public summary routes use shared-cache headers and expose a public visit-data `version` / `updatedAt` signal that changes on visit create/update/delete and visit image upload/delete/reorder.
- Visit and management routes use `private, no-store`.
- Trip planner suggestion, route-search, and nearby-origin routes all use `private, no-store` and keep the provider key server-side.
- All write routes and `GET /api/admin/parks/visibility` require a valid admin session cookie.
- `PATCH /api/parks/:slug` updates the admin-editable park fields and auto-generates a slug from `name` when no explicit `slug` is provided.
- `PATCH /api/parks/:slug/removed` toggles whether a park is hidden from catalog and visit responses.
- Auth routes (`/auth/*`) bypass API key authentication so the OAuth flow can complete without a bearer token.
- `GET /health` and `GET /openapi.json` are the only anonymous data endpoints.
- `/auth/*` routes are anonymous control-flow endpoints for login, not anonymous data endpoints.
- All `/api/*` endpoints, including `/api/public/*`, currently require the API key outside localhost.
- Image routes are only registered when R2 credentials (or `MEMORY_STORAGE=true`) are configured.
- Localhost-style server uploads still use `POST /api/visits/:id/images`, which accepts multipart/form-data, resizes images with Sharp, and stores derived JPEGs in R2 or memory storage.
- Deployed clients should use the Vercel-safe direct flow instead: `POST /api/visits/:id/images/upload-url`, upload the file to the returned presigned `PUT` URL, then call `POST /api/visits/:id/images/complete`.
- The direct flow currently stores the uploaded object as both the full-size and thumbnail asset, so it avoids Vercel body and Sharp runtime limits without requiring server-side image processing.
- Image responses include time-limited presigned URLs so the R2 bucket can remain private.

## Deployment Direction

The production target is Vercel Functions plus Turso. This repository now matches Vercel's Hono zero-config deployment shape through `src/index.ts`, including the direct `hono` import Vercel looks for in a recognized entry file.
This is intentionally a narrow contract: `src/index.ts` is the one place that should advertise Hono to Vercel, while `src/app.ts` stays framework-agnostic enough to avoid entrypoint mis-detection.

### Vercel Deployment Checklist

1. Create a Turso database for the deployed environment and copy its `libsql://...` URL plus auth token.
2. In Vercel, create a new project from this repository.
3. Keep the framework/build settings on auto-detect unless you have a repo-specific reason to override them.
4. Set at least these environment variables in Vercel:
   - `API_KEY`
   - `DATABASE_URL`
   - `DATABASE_AUTH_TOKEN`
5. If you will use Google OAuth for a frontend control panel, also set:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` only when `/auth/*` is served through a frontend proxy or rewrite
   - `AUTH_JWT_SECRET`
   - `AUTH_COOKIE_NAME`
   - `FRONTEND_URL`
6. If you will use visit image uploads or park logo uploads, also set the R2 variables:
   - `R2_BUCKET_NAME`
   - `R2_ENDPOINT`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
7. Frontends deployed against Vercel should call the direct upload endpoints instead of posting image bytes to `POST /api/visits/:id/images`.
8. Add the deployed Google OAuth callback URL to Google OAuth credentials if auth is enabled:
   - Direct API callback: `https://<your-api-domain>/auth/google/callback`
   - Frontend proxy/rewrite callback: `https://<your-frontend-domain>/auth/google/callback`
   - If you use `GOOGLE_REDIRECT_URI`, it must exactly match the URI registered in Google Cloud.
9. Start the login flow through the same public domain that owns the callback URI so the OAuth state/session cookies stay on the correct host.
10. Run database migrations against the production Turso database before relying on the deployment.
11. Import catalog data into the production database after migrations.
12. Verify `GET /health`, `GET /openapi.json`, and one real catalog endpoint on the deployed URL.

### Production Data Operations

Vercel only serves the HTTP API. Database migrations and park imports are still operational commands you run against the target Turso database:

```sh
DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npm run db:migrate
DATABASE_URL=libsql://... DATABASE_AUTH_TOKEN=... npm run import:parks
```

Run those from your machine or CI with the production credentials before expecting the deployed API to serve real catalog data.
