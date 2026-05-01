# Development Notes

This document captures the intended local development workflow before implementation starts. It should be updated as soon as the real scripts, dependencies, and database commands exist.

## Planned Local Workflow

The first implementation should support this shape:

```sh
npm install
npm run db:migrate
npm run import:parks
npm run verify
npm run dev
```

The exact package manager and script names can change during implementation, but the workflow should remain:

1. Install dependencies.
2. Prepare the local database.
3. Import park catalog data from LIPAS.
4. Run verification before handoff.
5. Start the API locally.

## Environment

Planned environment variables:

```sh
DATABASE_URL=file:./data/local.db
DATABASE_AUTH_TOKEN=
LIPAS_NATIONAL_PARKS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1
```

Turso/Vercel deployment variables should use the same names where possible:

```sh
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

The local SQLite/libSQL file should not be committed.

## Importer Workflow

The importer should:

- Fetch LIPAS sports sites with type code `111`.
- Keep only records where `status` is `active`.
- Expect 41 active records for the current dataset.
- Upsert catalog rows by `lipasId`.
- Preserve personal notes and visit history during catalog re-imports.
- Derive slug, marker point, and bounding box from imported data.
- Store boundary GeoJSON for detail/map-boundary usage.
- Exclude contact email, phone number, and comment text.
- Update import metadata so catalog ETags change when imported catalog data changes.

If the active count changes, the importer should finish loudly enough for a human to notice. The exact behavior can be a warning or a failing command, but it must not silently drift.

## Database Direction

Use Drizzle ORM with libSQL-compatible SQLite. Keep schema ownership in the repository so the API does not depend on live upstream availability for normal use.

Expected table groups:

- Park catalog data imported from LIPAS.
- Personal park notes.
- Personal visit records.
- Optional import run metadata.

Personal data must not be removed by catalog synchronization.

Local development should use a file database. Production should target Turso with the same Drizzle schema and libSQL client path.

## API Development Direction

Use contract-first route development:

- Define Zod schemas first.
- Generate or expose OpenAPI from those schemas.
- Implement route handlers against the schemas.
- Verify runtime responses match the contract.

The list endpoint should be optimized for map/list views. Full boundary geometry belongs on the detail endpoint or behind an explicit include flag.

Catalog endpoints should be cache-friendly:

- read only from the local/Turso database
- emit deterministic ETags
- return `304 Not Modified` for matching `If-None-Match`
- avoid mixing personal note or visit state into public catalog responses

Personal endpoints should use private or no-store cache policy.

## Deployment Direction

The first target is local personal use, but production design decisions should assume Vercel Functions and Turso. Avoid adding deployment machinery before implementation needs it, but do not choose libraries or route shapes that make Vercel/Turso awkward later.
