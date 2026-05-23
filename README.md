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

## Setup

```sh
npm install
cp .env.example .env
npm run db:migrate
npm run import:parks
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
LIPAS_PROTECTED_AREAS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=103,109,110,111,112&page-size=100&page=1

# Optional: enable Google OAuth login for the control panel
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_JWT_SECRET=change-me-to-a-long-random-string
FRONTEND_URL=http://localhost:4300

# Optional: Cloudflare R2 storage for visit images (bucket can be private)
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
```

## API Shape

- `GET /health`
- `GET /openapi.json`
- `GET /api/parks`
- `GET /api/parks/removed`
- `GET /api/parks/:slug`
- `GET /api/public/home-summary`
- `GET /api/public/map-summary`
- `GET /api/parks/:slug/visits`
- `POST /api/parks/:slug/visits`
- `PATCH /api/parks/:slug/removed`
- `GET /api/visits`
- `GET /api/visits/:id`
- `PATCH /api/visits/:id`
- `DELETE /api/visits/:id`
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
- `GET /api/parks/removed` returns an auth-restricted admin list of removed parks so the UI can restore visibility when needed.
- `GET /api/parks?type=state-hiking-area` filters by normalized type slug.
- `GET /api/parks/:slug?includeBoundary=true` includes stored boundary geometry.
- Park responses now expose `location` instead of `locationLabel`, with the value formatted as `location_label, postal_office` when a postal office exists.
- `GET /api/public/home-summary` returns public visit totals, type progress, recent activity, and a public data `version` / `updatedAt` signal without notes, routes, or images.
- `GET /api/public/map-summary` returns lightweight park map data plus per-park visited summaries and the same public data version signal.
- `GET /api/parks/:slug/visits` returns visit history plus a visited summary for one park.
- `GET /api/visits` returns flat visit resources with their parent park reference.
- `GET /api/visits/:id` returns one visit with its parent park reference.
- Catalog and public summary `GET` endpoints emit deterministic `ETag` headers and support `304 Not Modified`.
- Public summary endpoints use `Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400`.
- Public summary versions bump when public visit data changes, including visit create/update/delete and visit image upload/delete/reorder.
- Visit and management endpoints use `Cache-Control: private, no-store`.
- `PATCH /api/parks/:slug/removed` lets the UI hide or restore a park by toggling its persisted `removed` flag.

## Data Source

The catalog importer should use:

```text
https://api.lipas.fi/v2/sports-sites?type-codes=103,109,110,111,112&page-size=100&page=1
```

Importer expectations:

- Keep only `status === "active"` records.
- Expect 373 active records in the current dataset as of 2026-05-21.
- Import these supported LIPAS protected-area types:
  - `103` Ulkoilu-/virkistysalue
  - `109` Valtion retkeilyalue
  - `110` Erämaa-alue
  - `111` Kansallispuisto
  - `112` Muu luonnonsuojelualue
- Store normalized type metadata in a dedicated type table and reference it from catalog rows.
- Store catalog fields needed for a map app.
- Exclude LIPAS contact email, phone number, and comment text.
- Refresh `luontoonUrl` from Luontoon's official Finnish sitemap when a matching destination exists, instead of trusting LIPAS `www` blindly.
- Preserve personal notes and visit history across imports.
- Preserve manual park removals across imports and exclude removed rows from API responses.
- Read from the local/libSQL database during normal API requests instead of calling LIPAS live.

## Verification

The main quality gate is:

```sh
npm run verify
```

It runs typecheck, lint, and coverage tests with 100 percent thresholds for first-party application code. This must pass before any change is considered ready, unless the change is entirely outside what `verify` validates — for example, pure documentation updates.

## Documentation

- [AGENTS.md](AGENTS.md): codebase rules for future agents and implementation sessions.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local development, database, importer, and deployment notes.
- [docs/TESTING.md](docs/TESTING.md): testing strategy and verification expectations.
