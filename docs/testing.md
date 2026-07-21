# Testing Strategy

This repository uses behavior-first testing. Tests prove the behavior that a real API consumer, importer operator, or future map application depends on.

## Skill Guidance

The installed local skills set the testing posture:

- `intelligence-testing`: write behavior-first tests before implementation.
- `api-contract-sync`: keep schemas, OpenAPI, runtime responses, fixtures, and future clients aligned.
- `local-first-verification`: run the cheapest meaningful checks first and report real gaps.
- `mutation-testing`: use scoped mutation testing for backend logic after normal tests pass.

## Test Layers

Use API integration tests for:

- route behavior
- request validation
- response contracts
- ETag and cache-control behavior
- persistence behavior
- visit workflows
- importer plus database behavior when realistic enough
- deployment-entry contracts that cannot be reproduced reliably through localhost alone, such as Vercel's Hono auto-detection behavior

Use focused unit tests for:

- LIPAS-to-domain mapping
- slug creation
- Park URL normalization
- bounding box calculation
- marker point derivation
- small pure validation helpers

Use mutation testing for:

- importer filtering
- field exclusion rules
- mapper behavior
- API validation branches
- repository persistence logic

## Security And Sustainability Regression Targets

Add or update tests when a change touches:

- route access classification such as anonymous remote, API-key, or admin-session behavior
- cache headers or `ETag` behavior on catalog and summary routes
- upload size, content-type, or orphan-cleanup behavior
- OAuth callback, session cookie, or allowlist trust decisions
- env guardrails that protect Vercel, Turso, or storage usage
- new live third-party request-path dependencies or fallback behavior

If docs say a route is public or private, an integration test should prove the same policy.
If an upload limit exists, at least one test should cover the real stored-object validation path instead of only the client-declared metadata.

## Covered V1 Scenarios

- Import keeps only active supported LIPAS catalog records.
- Import persists normalized catalog type metadata and park-to-type references.
- Import accepts route-based `4403` walking trails, `4404` nature trails, and `4405` hiking trails; it skips walking trails when any route point overlaps an imported area and skips other trail imports when they are fully contained inside an imported area or match an imported area's `locationLabel + postalCode + postalOffice`.
- Import excludes contact email, phone number, and comment text.
- Import stores the expected catalog fields.
- Import derives stable slugs, marker points, and bounding boxes.
- Re-import updates catalog fields without deleting visits.
- Manual catalog imports can add non-LIPAS-managed parks such as Paistjärvi, including custom top-level types such as `cultural-history-area` and custom `displayTypeName` values, and later LIPAS imports do not deactivate those rows.
- Import prefers official Luontoon sitemap destination URLs over stale LIPAS `www` links and falls back when no sitemap match exists.
- Re-import preserves admin-managed edits to the editable park fields while still refreshing the imported baseline values underneath.
- `GET /api/parks` returns lightweight list/map data without full boundary geometry.
- `GET /api/parks/search` returns a smaller visible-park payload for search/autocomplete consumers.
- `GET /api/admin/parks/visibility` returns lightweight visible and removed park arrays in one private admin-session response for admin tooling.
- `GET /api/parks?type=...` filters the public catalog list by normalized type slug.
- `GET /api/parks?category=...` can collapse multiple source types into one public category, including `hiking-and-wilderness-areas`.
- `GET /api/parks?category=...` filters the public catalog list by derived API category, such as `trails-and-routes`.
- `GET /api/parks/:slug` returns catalog detail without visit state.
- `GET /api/parks/:slug` also returns removed-park detail when the request carries a valid admin session cookie.
- `PATCH /api/parks/:slug` updates the editable admin-managed park fields and auto-generates a slug when only `name` changes.
- `tests/integration/vercel-entry.integration.test.ts` protects the Vercel entrypoint contract by ensuring `src/index.ts` remains the recognized Hono entry file and `src/app.ts` does not import directly from `hono`.
- Park catalog responses expose both the source `type` and a derived `category`.
- Park catalog responses expose linked logo metadata and stable logo URLs when a park logo has been configured.
- Park responses expose raw `locationLabel`, `postalCode`, and `postalOffice` fields from the database, plus a derived `address` string for display use.
- `GET /api/home-summary` returns cache-friendly home summary data including seasonal visit counts, `progressByType` visibility flags, and aggregated `progressByCategory`, without notes, routes, or images.
- `GET /api/map-summary` returns lightweight map data plus per-park visited summaries.
- `GET /api/visits-timeline` returns the lightweight `/kaynnit` timeline dataset with `imageCount` and pre-resolved park `typeLabel` values.
- `POST /api/trip-planner/suggestions` returns up to three Geoapify-backed place suggestions with labels and coordinates for origin/destination pickers.
- `POST /api/trip-planner/search` geocodes endpoints server-side, filters parks against the real routed path, excludes parks outside the corridor, preserves the documented unvisited-first ordering, suppresses overly broad matches from the first 30 km of long trips, and returns map-ready route geometry plus route and park bounding boxes.
- `GET /api/parks/:slug/visits` returns park-scoped visit history and visited summary.
- `GET /api/visits` and `GET /api/visits/:id` expose visit resources with parent park references.
- Catalog, home summary, map summary, and visits timeline `GET` endpoints emit ETags and return `304 Not Modified` for matching `If-None-Match`.
- Catalog `GET` endpoints are safe for public caching.
- Home summary, map summary, and visits timeline endpoints use shared-cache headers and bump their version signal when visit or visit-image data changes.
- Visit and management endpoints are private or no-store.
- Trip planner provider failures surface as stable app errors instead of raw Geoapify responses.
- All write routes and admin-only visibility reads require an admin session and fail closed when OAuth session auth is unavailable.
- Park removal toggle can hide and restore a park through the authenticated park-management API.
- Visit create/edit/delete supports optional route and author fields.
- Visit create/edit/delete works against a real temporary database.
- Park logo upload logic verifies the park slug, prefers `data/logos/<slug>.png`, falls back to `data/logos/display-types/<normalized-display-type>.png` when a park shares a display type, uploads the resolved file once to the matching R2 key, and persists the logo reference in the database.
- Auth routes bypass bearer-token middleware.
- Google OAuth callback validates state/PKCE, verifies the ID token, checks the admin allowlist, and sets a session cookie.
- `GET /auth/me` returns the current user from a valid session or `401` otherwise.
- `POST /auth/logout` clears the session cookie.
- Runtime API handlers are implemented against the same Zod/OpenAPI contract definitions.
- Auth, cache, and documentation claims stay aligned for `/health`, `/openapi.json`, `/auth/*`, and `/api/*` route families.
- Direct-upload tests should protect the real object-size and content-type checks whenever that flow changes.

## Required Scripts

The implementation should provide these scripts:

- `npm run typecheck`
- `npm run test`
- `npm run test:coverage`
- `npm run lint`
- `npm run verify`

`npm run verify` is the main local quality gate. It must run at least typecheck, lint (with apply safe fixes), and coverage tests.
The lint step should fail on any Biome diagnostics, including info-level configuration notices and warning-level findings, rather than treating them as ignorable output.

Coverage thresholds should start high from the beginning. Aim for 100 percent on first-party application code, excluding generated artifacts, migrations, config, and unavoidable runtime glue explicitly rather than letting them lower the target silently.

## Quality Gate

`npm run verify` must pass before any task or pull request is considered ready. The only exception is changes that are entirely outside what `verify` validates — for example, pure documentation updates or repository configuration that does not affect code, tests, or types. In those cases, skip `verify` and note the exception in the PR description. User review and explicit acceptance are required before merging.

## Verification Order

For implementation tasks, start with the cheapest check that can fail for the right reason:

1. Focused test for the changed behavior.
2. Typecheck or lint when configured.
3. API integration tests for touched routes/importer behavior, especially auth and cache boundaries.
4. Full verification command (`npm run verify`).
5. Scoped mutation run for meaningful backend logic.

Do not claim behavior is verified unless the check actually exercised it.
When a production platform behavior cannot be reproduced locally, add the smallest regression test that proves the repo-side contract the platform depends on, and document that contract near the affected runtime files.

## CI

Pull requests against `main` trigger a GitHub Actions workflow that runs `npm run verify`. The build must pass before review and merge.

The Vitest `testTimeout` is raised to 20 seconds because full-catalog importer integration tests insert 148 fixture records per test and can exceed the 5-second default on constrained CI runners even though they finish in well under a second locally.
