# Finnish National Parks API V1 Plan

## Summary

Build a TypeScript API for Finnish national parks. The API imports park catalog data from the open LIPAS API into an owned SQLite-compatible database, serves normalized park data for a future map app, and stores personal notes plus visit history.

Local development should use a SQLite/libSQL file. The intended deployed target is Vercel Functions with Turso.

Use Luontoon only as an official external link. Do not scrape or republish Luontoon page content.

## Documentation First

- Add `AGENTS.md` before implementation code, defining project rules, testing expectations, API contract workflow, and local-first verification.
- Expand `README.md` with project purpose, stack, setup, import flow, API overview, and data-source notes.
- Add `docs/DEVELOPMENT.md` for local setup, scripts, database workflow, importer workflow, and Turso migration notes.
- Add `docs/TESTING.md` for behavior-first testing, contract checks, local verification, and mutation testing expectations.
- Keep this plan under `docs/plans/` as implementation reference for later sessions.

## Stack

- Runtime/API: Node.js, TypeScript, Hono.
- Validation/contract: Zod plus OpenAPI generation.
- Database: Drizzle ORM with `@libsql/client`.
- Local database default: `DATABASE_URL=file:./data/local.db`.
- Production database target: Turso via `DATABASE_URL` and `DATABASE_AUTH_TOKEN`.
- Deployment target: Vercel Functions, preferably Node.js runtime first unless Edge runtime becomes necessary.

## Data Source

Import from LIPAS:

```text
https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1
```

Importer rules:

- Filter to `status === "active"`.
- Expect 41 active parks based on the current LIPAS response and official Metsahallitus/Luontoon count.
- Warn or fail loudly if the active count changes.
- Upsert catalog data by `lipasId`.
- Preserve personal notes and visits across imports.
- Normalize Luontoon URLs so consumers can rely on absolute URLs.
- Store source metadata so future debugging can identify the imported snapshot.
- Treat imported catalog data as a durable local cache. Normal API requests must not call LIPAS.

Store these catalog fields:

- `lipasId`
- stable slug
- Finnish name
- area km2
- establishment year
- address or place label
- postal office
- municipality code
- normalized Luontoon URL
- source event date
- boundary GeoJSON
- derived bounding box
- derived marker point

Do not store:

- LIPAS contact email
- LIPAS phone number
- LIPAS comment text
- Luontoon page descriptions, photos, rules, or other copied page content

## API

Planned endpoints:

- `GET /health`
- `GET /api/parks`
- `GET /api/parks/:slug`
- `GET /api/me/parks`
- `GET /api/me/parks/:slug`
- `PUT /api/me/parks/:slug/note`
- `POST /api/me/parks/:slug/visits`
- `PATCH /api/me/visits/:id`
- `DELETE /api/me/visits/:id`

`GET /api/parks` should return lightweight catalog list/map data:

- park identity
- name
- area and establishment year
- location label
- Luontoon URL
- marker point
- bounding box

`GET /api/parks/:slug` should return catalog detail:

- catalog detail
- optional boundary GeoJSON

`GET /api/me/parks` and `GET /api/me/parks/:slug` should return personal state:

- personal note
- visit history
- visited summary

Boundary geometry should not be included in the lightweight list response by default.

## Caching

Use three caching layers:

- Import cache: LIPAS is called only by the manual importer. Imported catalog rows and import metadata are stored in the database.
- HTTP validators: catalog `GET` endpoints must emit deterministic `ETag` values and return `304 Not Modified` when `If-None-Match` matches.
- CDN/browser policy: catalog-only endpoints may use public Vercel CDN caching; personal endpoints must not be publicly cached.

ETag rules:

- Catalog ETags should be derived from stable catalog version data, such as latest successful import id, import timestamp, source event dates, and response shape version.
- Catalog list and detail ETags may differ because detail responses can include boundary GeoJSON.
- Manual re-import must change affected catalog ETags when stored catalog data changes.
- Personal endpoints may use private ETags later, but V1 should prefer `Cache-Control: private, no-store` or an equivalent conservative policy for notes and visits.

Recommended response cache policy:

- Catalog endpoints: public cache headers plus ETags.
- Personal endpoints: private or no-store cache headers.
- Mutation endpoints: no-store.

## Persistence

Use separate ownership boundaries for imported catalog data and personal data:

- Catalog data can be overwritten by imports.
- Personal note and visit data must survive imports.
- Deletes from upstream should not automatically delete personal history. If a park disappears from active source data later, preserve local personal data and mark catalog status intentionally.

Expected data groups:

- parks
- park notes
- park visits
- import runs or source metadata

## Testing And Development Style

Follow installed skill guidance:

- `intelligence-testing`: behavior-first tests before implementation.
- `api-contract-sync`: OpenAPI/schema source of truth stays synced with runtime responses.
- `local-first-verification`: run the cheapest meaningful local checks first.
- `mutation-testing`: use scoped backend mutation testing for importer, mapper, validation, and persistence logic when regular tests pass.

Required test scenarios:

- Importer keeps only active LIPAS national parks.
- Importer excludes contact details and comments.
- Mapper normalizes Luontoon URLs and creates stable slugs.
- Geometry mapper derives bounding box and marker point.
- Re-import updates catalog data without deleting notes or visits.
- Catalog endpoints emit ETags and return `304 Not Modified` for matching `If-None-Match`.
- Catalog endpoints return `200` with a changed ETag after imported catalog data changes.
- Catalog endpoints do not include personal data.
- Personal endpoints are not publicly cacheable.
- API responses match OpenAPI/Zod schemas.
- Notes and visits persist through real database-backed integration tests.

Required scripts:

- `npm run typecheck`
- `npm run test`
- `npm run test:coverage`
- `npm run verify`

`npm run verify` must aggregate the main local quality gates and run at least typecheck plus coverage tests. Coverage thresholds should start high, ideally 100 percent for first-party application code, with generated files, migrations, config, and unavoidable platform glue excluded explicitly.

## Assumptions

- V1 uses Finnish park names from LIPAS.
- V1 does not import trails, facilities, photos, visitor counts, rules, or long descriptions.
- Boundary geometry is available through detail endpoints, not the lightweight list endpoint.
- The first runtime target is local development, but production design decisions should assume Vercel Functions and Turso.

## Source Links

- LIPAS API root: <https://api.lipas.fi/>
- LIPAS national park query: <https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1>
- LIPAS data information: <https://www.jyu.fi/en/node/129134/lipas-liikunnan-paikkatietojarjestelma>
- Luontoon national parks article: <https://www.luontoon.fi/en/articles/national-parks>
- Luontoon terms of use: <https://www.luontoon.fi/en/terms-of-use>
