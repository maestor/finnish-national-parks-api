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

Use focused unit tests for:

- LIPAS-to-domain mapping
- slug creation
- Luontoon URL normalization
- bounding box calculation
- marker point derivation
- small pure validation helpers

Use mutation testing for:

- importer filtering
- field exclusion rules
- mapper behavior
- API validation branches
- repository persistence logic

## Covered V1 Scenarios

- Import keeps only active supported LIPAS catalog records.
- Import persists normalized catalog type metadata and park-to-type references.
- Import accepts route-based `4404` nature trails and skips trails fully contained inside an imported area or matching an imported area's `locationLabel + postalCode + postalOffice`.
- Import excludes contact email, phone number, and comment text.
- Import stores the expected catalog fields.
- Import derives stable slugs, marker points, and bounding boxes.
- Re-import updates catalog fields without deleting visits.
- Manual catalog imports can add non-LIPAS-managed parks with a custom `displayTypeName`, and later LIPAS imports do not deactivate those rows.
- Import prefers official Luontoon sitemap destination URLs over stale LIPAS `www` links and falls back when no sitemap match exists.
- `GET /api/parks` returns lightweight list/map data without full boundary geometry.
- `GET /api/parks/removed` returns a private admin list of removed parks for restore flows.
- `GET /api/parks?type=...` filters the public catalog list by normalized type slug.
- `GET /api/parks/:slug` returns catalog detail without visit state.
- Park catalog responses expose linked logo metadata and stable logo URLs when a park logo has been configured.
- Park responses expose `location` instead of `locationLabel`, combining address and postal office when both exist, but collapsing to one value when they are identical or only one exists.
- `GET /api/public/home-summary` returns cache-friendly public summary data including seasonal visit counts, without notes, routes, or images.
- `GET /api/public/map-summary` returns lightweight map data plus per-park visited summaries.
- `GET /api/parks/:slug/visits` returns park-scoped visit history and visited summary.
- `GET /api/visits` and `GET /api/visits/:id` expose visit resources with parent park references.
- Catalog and public summary `GET` endpoints emit ETags and return `304 Not Modified` for matching `If-None-Match`.
- Catalog `GET` endpoints are safe for public caching.
- Public summary endpoints use shared-cache headers and bump their version signal when visit or visit-image public data changes.
- Visit and management endpoints are private or no-store.
- Park removal toggle can hide and restore a park through the authenticated park-management API.
- Visit create/edit/delete supports optional route and author fields.
- Visit create/edit/delete works against a real temporary database.
- Park logo upload logic verifies the park slug, prefers `data/logos/<slug>.png`, falls back to `data/logos/display-types/<normalized-display-type>.png` when a park shares a display type, uploads the resolved file once to the matching R2 key, and persists the logo reference in the database.
- Auth routes bypass bearer-token middleware.
- Google OAuth callback validates state/PKCE, verifies the ID token, checks the admin allowlist, and sets a session cookie.
- `GET /auth/me` returns the current user from a valid session or `401` otherwise.
- `POST /auth/logout` clears the session cookie.
- Runtime API handlers are implemented against the same Zod/OpenAPI contract definitions.

## Required Scripts

The implementation should provide these scripts:

- `npm run typecheck`
- `npm run test`
- `npm run test:coverage`
- `npm run lint`
- `npm run verify`

`npm run verify` is the main local quality gate. It must run at least typecheck, lint (with apply safe fixes), and coverage tests.

Coverage thresholds should start high from the beginning. Aim for 100 percent on first-party application code, excluding generated artifacts, migrations, config, and unavoidable runtime glue explicitly rather than letting them lower the target silently.

## Quality Gate

`npm run verify` must pass before any task or pull request is considered ready. The only exception is changes that are entirely outside what `verify` validates — for example, pure documentation updates or repository configuration that does not affect code, tests, or types. In those cases, skip `verify` and note the exception in the PR description. User review and explicit acceptance are required before merging.

## Verification Order

For implementation tasks, start with the cheapest check that can fail for the right reason:

1. Focused test for the changed behavior.
2. Typecheck or lint when configured.
3. API integration tests for touched routes/importer behavior.
4. Full verification command (`npm run verify`).
5. Scoped mutation run for meaningful backend logic.

Do not claim behavior is verified unless the check actually exercised it.

## CI

Pull requests against `main` trigger a GitHub Actions workflow that runs `npm run verify`. The build must pass before review and merge.
