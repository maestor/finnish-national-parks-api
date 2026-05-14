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

## Runtime Requirements

- Node.js 24 or newer.

## Branch And PR Workflow

- Create a dedicated branch for every change: `feature/<name>`, `bugfix/<name>`, `chore/<name>`, `docs/<name>`, etc.
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
LIPAS_PROTECTED_AREAS_URL=https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=100&page=1
PORT=3004

# Google OAuth (optional — only needed for control-panel login)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AUTH_JWT_SECRET=change-me-to-a-long-random-string
AUTH_COOKIE_NAME=__session
FRONTEND_URL=http://localhost:4300

# Cloudflare R2 (optional — only needed for visit image uploads)
R2_BUCKET_NAME=
R2_ENDPOINT=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_PUBLIC_URL=
MEMORY_STORAGE=false
```

All variables are optional for local development — sensible defaults are built in. `API_KEY` is only required if you want to test authenticated access locally; localhost requests bypass auth even when it is set.

OAuth routes (`/auth/*`) are only registered when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `AUTH_JWT_SECRET` are all provided.

Turso/Vercel deployment variables should use the same names where possible:

```sh
DATABASE_URL=libsql://...
DATABASE_AUTH_TOKEN=...
```

The local SQLite/libSQL file and `.env` itself should not be committed.

## Importer Workflow

The importer should:

- Fetch LIPAS sports sites with type codes `109,110,111,112`.
- Keep only records where `status` is `active`.
- Expect 137 active records for the current dataset.
- Upsert catalog rows by `lipasId`.
- Upsert normalized protected-area types in a dedicated `park_types` table.
- Preserve personal visit history during catalog re-imports.
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
- personal visit records
- visit images
- import run metadata
- admin allowlist (`admins`)

Personal data must not be removed by catalog synchronization.

### Admin Allowlist

The `admins` table stores allowed Google email addresses for control-panel access. It contains only `email`, `created_at`, and `updated_at` — no Google IDs, names, or pictures are persisted.

Add an admin manually:

```sh
sqlite3 data/local.db "INSERT INTO admins (email, created_at, updated_at) VALUES ('admin@example.com', datetime('now'), datetime('now'));"
```

Local development should use a file database. Production should target Turso with the same Drizzle schema and libSQL client path.

## API Contract

The API uses Zod schemas as the contract source of truth with OpenAPI exposed at `GET /openapi.json`.

Key route behavior:

- `GET /api/parks` is optimized for map/list views and omits boundary geometry.
- `GET /api/parks?type=state-hiking-area` filters by normalized protected-area type slug.
- `GET /api/parks/:slug?includeBoundary=true` returns the stored boundary GeoJSON.
- Catalog routes emit deterministic `ETag` headers and support `304 Not Modified`.
- Personal routes use `private, no-store`.
- Auth routes (`/auth/*`) bypass API key authentication so the OAuth flow can complete without a bearer token.
- All other non-public endpoints require API key authentication; localhost requests are exempt.
- Image upload routes (`POST /api/me/visits/:id/images`) accept multipart/form-data, resize images with Sharp, and store them in R2. They are only registered when R2 credentials (or `MEMORY_STORAGE=true`) are configured.

## Deployment Direction

The first target is local personal use, but production design decisions should assume Vercel Functions and Turso. Avoid adding deployment machinery before implementation needs it, but do not choose libraries or route shapes that make Vercel/Turso awkward later.
