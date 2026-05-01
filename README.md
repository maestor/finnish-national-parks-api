# Finnish National Parks API

A local-first TypeScript API for Finnish national park catalog data and personal visit tracking.

The API imports national park data from the open LIPAS API into an owned SQLite/libSQL database, then serves it for a future personal map application where parks can have notes and visit history.

## Goals

- Keep a small, reliable national parks catalog in an owned database.
- Use LIPAS as the machine-readable source for park names, locations, boundaries, area, establishment year, and Luontoon links.
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
npm run db:migrate
npm run import:parks
npm run verify
npm run dev
```

Default environment:

```sh
DATABASE_URL=file:./data/local.db
DATABASE_AUTH_TOKEN=
LIPAS_NATIONAL_PARKS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1
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
- `GET /api/parks/:slug?includeBoundary=true` includes stored boundary geometry.
- Catalog `GET` endpoints emit deterministic `ETag` headers and support `304 Not Modified`.
- Personal endpoints use `Cache-Control: private, no-store`.

## Data Source

The catalog importer should use:

```text
https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1
```

Importer expectations:

- Keep only `status === "active"` records.
- Expect 41 active national parks in the current dataset.
- Store catalog fields needed for a map app.
- Exclude LIPAS contact email, phone number, and comment text.
- Preserve personal notes and visit history across imports.
- Read from the local/libSQL database during normal API requests instead of calling LIPAS live.

## Verification

The main quality gate is:

```sh
npm run verify
```

It runs typecheck plus coverage tests with 100 percent thresholds for first-party application code.

## Documentation

- [AGENTS.md](AGENTS.md): codebase rules for future agents and implementation sessions.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): local development, database, importer, and deployment notes.
- [docs/TESTING.md](docs/TESTING.md): testing strategy and verification expectations.
- [docs/plans/2026-05-01-finnish-national-parks-api-v1.md](docs/plans/2026-05-01-finnish-national-parks-api-v1.md): current V1 implementation plan.
