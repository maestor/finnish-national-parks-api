# Finnish National Parks API

A local-first TypeScript API for Finnish protected-area catalog data and personal visit tracking.

The API imports selected protected-area data from the open LIPAS API into an owned SQLite/libSQL database, then serves it for a future personal map application where places can have notes and visit history.

## Goals

- Keep a small, reliable protected-areas catalog in an owned database.
- Use LIPAS as the machine-readable source for place names, locations, boundaries, area, establishment year, and Luontoon links.
- Use Luontoon only as an official external reference link.
- Store personal notes and visit history separately from imported catalog data.
- Start locally with SQLite/libSQL and target Turso on Vercel for deployment.
- Keep imported catalog data heavily cached and never fetch LIPAS during normal API reads.

## Planned Stack

- Node.js and TypeScript.
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
LIPAS_PROTECTED_AREAS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=100&page=1
```

## API Shape

- `GET /health`
- `GET /openapi.json`
- `GET /api/parks`
- `GET /api/parks/:slug`
- `GET /api/me/parks`
- `GET /api/me/parks/:slug`
- `PUT /api/me/parks/:slug/note`
- `POST /api/me/parks/:slug/visits`
- `PATCH /api/me/visits/:id`
- `DELETE /api/me/visits/:id`

Catalog endpoints stay cache-friendly and database-backed:

- `GET /api/parks` returns lightweight list data without boundary GeoJSON.
- `GET /api/parks?type=state-hiking-area` filters by normalized type slug.
- `GET /api/parks/:slug?includeBoundary=true` includes stored boundary geometry.
- Catalog `GET` endpoints emit deterministic `ETag` headers and support `304 Not Modified`.
- Personal endpoints use `Cache-Control: private, no-store`.

## Data Source

The catalog importer should use:

```text
https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=100&page=1
```

Importer expectations:

- Keep only `status === "active"` records.
- Expect 137 active protected areas in the current dataset.
- Import these supported LIPAS protected-area types:
  - `109` Valtion retkeilyalue
  - `110` Erämaa-alue
  - `111` Kansallispuisto
  - `112` Muu luonnonsuojelualue
- Store normalized type metadata in a dedicated type table and reference it from catalog rows.
- Store catalog fields needed for a map app.
- Exclude LIPAS contact email, phone number, and comment text.
- Preserve personal notes and visit history across imports.
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
- [docs/plans/2026-05-13-post-v1-improvements.md](docs/plans/2026-05-13-post-v1-improvements.md): current improvement plan.
