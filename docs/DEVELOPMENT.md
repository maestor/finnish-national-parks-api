# Development Notes

## Local Workflow

Current local workflow:

```sh
npm install
npm run db:migrate
npm run import:parks
npm run verify
npm run dev
```

## Environment

Environment variables:

```sh
DATABASE_URL=file:./data/local.db
DATABASE_AUTH_TOKEN=
LIPAS_PROTECTED_AREAS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=100&page=1
```

Turso/Vercel deployment variables should use the same names where possible:

```sh
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

The local SQLite/libSQL file should not be committed.

## Importer Workflow

The importer should:

- Fetch LIPAS sports sites with type codes `109,110,111,112`.
- Keep only records where `status` is `active`.
- Expect 137 active records for the current dataset.
- Upsert catalog rows by `lipasId`.
- Upsert normalized protected-area types in a dedicated `park_types` table.
- Preserve personal notes and visit history during catalog re-imports.
- Derive slug, marker point, and bounding box from imported data.
- Store boundary GeoJSON for detail/map-boundary usage.
- Exclude contact email, phone number, and comment text.
- Update import metadata so catalog ETags change when imported catalog data changes.

The current implementation fails the import if the active count does not match `137`, so upstream drift is visible immediately.

## Database

The repository owns the database schema through:

- [src/db/schema.ts](../src/db/schema.ts)
- [src/db/migrations/0000_init.sql](../src/db/migrations/0000_init.sql)

Current table groups:

- protected-area types
- imported park catalog rows
- personal park notes
- personal visit records
- import run metadata

Personal data must not be removed by catalog synchronization.

Local development should use a file database. Production should target Turso with the same Drizzle schema and libSQL client path.

## API Contract

The API uses Zod schemas as the contract source of truth with OpenAPI exposed at `GET /openapi.json`.

Key route behavior:

- `GET /api/parks` is optimized for map/list views and omits boundary geometry.
- `GET /api/parks?type=state-hiking-area` filters by normalized protected-area type slug.
- `GET /api/parks/:slug?includeBoundary=true` returns the stored boundary GeoJSON.
- catalog routes emit deterministic `ETag` headers and support `304 Not Modified`
- personal routes use `private, no-store`

## Deployment Direction

The first target is local personal use, but production design decisions should assume Vercel Functions and Turso. Avoid adding deployment machinery before implementation needs it, but do not choose libraries or route shapes that make Vercel/Turso awkward later.
