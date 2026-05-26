# Development Notes

## Local Workflow

Current local workflow:

```sh
npm install
npm run db:migrate
npm run import:parks
npm run import:merenkurkku
npm run park:logo -- <park-slug>
npm run db:backup
npm run verify
npm run dev
```

`npm run dev` and `npm run start` use the local Node server entrypoint at `src/local-server.ts`.
The Vercel deployment entrypoint is `src/index.ts`, which default-exports the Hono app and keeps a direct `hono` import so Vercel can auto-detect the project as Hono.

## Runtime Requirements

- Node.js 24 or newer.

## Branch And PR Workflow

- Create a dedicated branch for every change: `feature/<name>`, `bugfix/<name>`, `chore/<name>`, `docs/<name>`, etc.
- If you are currently on `main`, create or switch to the correct work branch before editing files, running write-capable fixers, or staging changes.
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

# Cloudflare R2 (optional — needed for visit image uploads and park logo uploads)
# Visit images can stay private; set R2_PUBLIC_URL if catalog APIs should expose stable logo URLs.
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_PUBLIC_URL=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
MEMORY_STORAGE=false
```

All variables are optional for local development — sensible defaults are built in. `API_KEY` is only required if you want to test authenticated access locally; localhost requests bypass auth even when it is set.
The importer's LIPAS source URL and supported type-code list are internal configuration rather than `.env` settings.

OAuth routes (`/auth/*`) are only registered when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_JWT_SECRET` are all provided.
`GOOGLE_REDIRECT_URI` is optional and only needed when the public OAuth callback is exposed through a frontend proxy or rewrite instead of the API domain itself.

Turso/Vercel deployment variables should use the same names where possible:

```sh
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

Vercel guardrails in this repo:

- `API_KEY` is required on Vercel so non-public endpoints are not exposed accidentally.
- `DATABASE_URL` cannot use the local `file:` default on Vercel.
- `MEMORY_STORAGE=true` is rejected on Vercel because it is ephemeral.
- If Google OAuth is enabled on Vercel, `FRONTEND_URL` cannot point at localhost.
- If `GOOGLE_REDIRECT_URI` is set on Vercel, it cannot point at localhost.

The local SQLite/libSQL file and `.env` itself should not be committed.

## Importer Workflow

The importer should:

- Fetch LIPAS sports sites with type codes `103,109,110,111,112,4404`.
- Keep only records where `status` is `active`.
- Expect 1174 active LIPAS records from the current source dataset as of 2026-05-24.
- Upsert catalog rows by `lipasId`.
- Upsert normalized catalog types in a dedicated `park_types` table.
- Persist both `postal_code` and `postal_office` from LIPAS for stronger location matching.
- Skip `4404` nature trails whose full route geometry is contained inside one imported area record.
- Skip `4404` nature trails whose normalized `location_label`, `postal_code`, and `postal_office` exactly match one imported area record.
- Preserve personal visit history during catalog re-imports.
- Preserve any manually set `parks.removed` flags during catalog re-imports.
- Refresh destination `luontoonUrl` values from `https://www.luontoon.fi/resources/sitemap/fi.xml` when the official sitemap contains a matching base destination URL.
- Derive slug, marker point, and bounding box from imported data.
- Store boundary GeoJSON for detail/map-boundary usage.
- Exclude contact email, phone number, and comment text.
- Update import metadata so catalog ETags change when imported catalog data changes.
- Keep non-LIPAS-managed catalog rows outside the normal LIPAS deactivation pass.

The current implementation fails the import if the active LIPAS record count does not match `1174`, so upstream drift is visible immediately.
If a destination cannot be matched from the official Luontoon sitemap, the importer falls back to the normalized LIPAS `www` value for that row.

### Manual Catalog Imports

This repo also supports a one-off manual catalog import for Merenkurkun maailmanperintöalue:

```sh
npm run import:merenkurkku
```

That command:

- imports the official world-heritage geometry into the existing `parks` table
- stores the row under the normalized `other-nature-reserve` type
- sets a park-level `displayTypeName` of `Maailmanperintökohde` for UI use
- uses `Raippaluodontie 2, 65800 Raippaluoto` as the generated location source
- marks the row as not managed by the LIPAS cleanup step, so later `npm run import:parks` executions do not deactivate it

### Park Logos

Downloaded source logo PNG files can live under `data/logos/` and stay local because the repository ignores `data/`.

To attach one logo to one existing park row:

```sh
npm run park:logo -- <park-slug>
```

That command:

- loads the current `.env` automatically
- uses `DATABASE_URL` and `DATABASE_AUTH_TOKEN` to target either local SQLite or remote Turso
- requires the matching `data/logos/<park-slug>.png` file to exist locally
- uploads the file to the R2 object key `logos/<park-slug>.png`
- stores the logo key plus a logo timestamp on the matching park row so catalog ETags and logo URLs change together

For UI rendering, set `R2_PUBLIC_URL` to the public base URL that serves those logo objects.

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
- `GET /api/parks/removed` returns an auth-restricted admin list of removed parks for restore workflows.
- `GET /api/parks?type=state-hiking-area` filters by normalized catalog type slug.
- `GET /api/parks/:slug?includeBoundary=true` returns the stored boundary GeoJSON.
- Park list, detail, removed, and public map responses expose `logo: { key, updatedAt, url } | null` when one has been linked to the park.
- Park responses expose `location` instead of `locationLabel`, combining `location_label` and `postal_office` when both exist, but collapsing to one value when they are identical or only one exists.
- `GET /api/public/home-summary` returns public home-page summary data including seasonal visit counts, without visit notes, routes, or images.
- `GET /api/public/map-summary` returns lightweight park map data plus per-park visited summaries.
- `GET /api/parks/:slug/visits` returns visit history plus a visited summary for one visible park.
- `GET /api/visits` returns flat visit resources with their parent park reference.
- `GET /api/visits/:id` returns one visit with its parent park reference.
- Catalog and public summary routes emit deterministic `ETag` headers and support `304 Not Modified`.
- Public summary routes use shared-cache headers and expose a public visit-data `version` / `updatedAt` signal that changes on visit create/update/delete and visit image upload/delete/reorder.
- Visit and management routes use `private, no-store`.
- `PATCH /api/parks/:slug/removed` toggles whether a park is hidden from catalog and visit responses.
- Auth routes (`/auth/*`) bypass API key authentication so the OAuth flow can complete without a bearer token.
- Public summary routes (`/api/public/*`) also bypass API key authentication so public UI pages can use them remotely.
- All other non-public endpoints require API key authentication; localhost requests are exempt.
- Image routes are only registered when R2 credentials (or `MEMORY_STORAGE=true`) are configured.
- Localhost-style server uploads still use `POST /api/visits/:id/images`, which accepts multipart/form-data, resizes images with Sharp, and stores derived JPEGs in R2 or memory storage.
- Deployed clients should use the Vercel-safe direct flow instead: `POST /api/visits/:id/images/upload-url`, upload the file to the returned presigned `PUT` URL, then call `POST /api/visits/:id/images/complete`.
- The direct flow currently stores the uploaded object as both the full-size and thumbnail asset, so it avoids Vercel body and Sharp runtime limits without requiring server-side image processing.
- Image responses include time-limited presigned URLs so the R2 bucket can remain private.

## Deployment Direction

The production target is Vercel Functions plus Turso. This repository now matches Vercel's Hono zero-config deployment shape through `src/index.ts`, including the direct `hono` import Vercel looks for in a recognized entry file.

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
   - `R2_PUBLIC_URL` for stable park logo URLs returned by catalog APIs
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
