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
- park featured-image backfill previews, published-only deterministic selection, preserved selections, repeat runs, transactional rollback, and real CLI migration/argument boundaries against temporary databases
- visit workflows
- manual OSM linked-trail merge CLI preview/apply/rerun, real membership triggers, visit-link deduplication, atomic rollback, source snapshot refresh, slug collisions and unchanged visit/photo data
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

## Integration coverage by workflow

Use the owning integration suite to find endpoint and fixture details. Keep
these invariants covered when changing the corresponding workflows.

- **Catalog imports** preserve catalog identity, admin edits, visits and manual trail overrides. Verify supported-source filtering, geometry normalization and measurements, the 10% overlap and 100 km length limits, bounded writes, rollback, visibility, and exclusion of contact fields. Manual imports use the same persistence guarantees and survive LIPAS refreshes.
- **Access and publication** protect admin reads and mutations, enforce independent trip and visit status, and keep hidden parents, draft relationships, and private waypoints out of public projections. Verify OAuth return validation, invitation enrollment, and super-admin permissions with real temporary databases.
- **Caching** covers conditional ETags, data-version changes, and private/no-store responses. Published review shares stay frozen until explicitly refreshed or unpublished.
- **Trips and visits** cover CRUD, shared itinerary ordering, published-only assignment rules, trail memberships, and route cache isolation between public and admin-preview geometry.
- **Media** covers upload size, image validation and derivatives, retry and ownership, stable URLs, publication-aware redirects, and safe preview and retry for backfills. Verify that published review snapshots still protect referenced objects.
- **Trip planning** covers local name resolution before provider calls, route corridor filtering, result ordering, and stable failures.

## Required Scripts

The implementation should provide these scripts:

- `npm run typecheck`
- `npm run test`
- `npm run test:coverage`
- `npm run lint`
- `npm run lint:fix`
- `npm run verify`

The lint step should fail on any Biome diagnostics, including info-level configuration notices and warning-level findings, rather than treating them as ignorable output.

Coverage thresholds should start high from the beginning. Aim for 100 percent on first-party application code, excluding generated artifacts, migrations, config, and unavoidable runtime glue explicitly rather than letting them lower the target silently.

## Quality Gate

`npm run verify` runs typecheck, lint, and coverage tests. The lint stage checks the submitted files without writing fixes. Run `npm run lint:fix` explicitly to apply supported fixes during development.

`npm run verify` must pass before any task or pull request is considered ready. The only exception is changes that are entirely outside what `verify` validates — for example, pure documentation updates or repository configuration that does not affect code, tests, or types. In those cases, skip `verify` and note the exception in the PR description. User review and explicit acceptance are required before merging.

## Pre-Review Coverage Closure

Do not wait for the post-review `npm run verify` step to discover obvious missing branches in newly added behavior.

Before the review pause for implementation work:

1. Run the cheapest focused test or test file that exercises the new behavior.
2. If the change adds a route, upload flow, or persistence workflow, cover the full behavior shape before asking for review:
   - happy path
   - auth failure
   - missing parent resource
   - validation and limit failures
   - storage or repository error branches that return user-facing responses
3. If the touched file contains explicit guards or fallback branches, inspect uncovered lines from focused coverage or the nearest targeted coverage run and close them while the implementation context is still fresh.
4. Only after the touched behavior is locally covered well enough that no obvious branch gaps remain should the change move to the review pause.

The goal is not to run the full repo gate early. The goal is to avoid turning the post-review verify step into a long branch-coverage cleanup session for behavior we already knew we added.

## Verification Order

For implementation tasks, start with the cheapest check that can fail for the right reason:

1. Focused test for the changed behavior.
2. Typecheck or lint when configured.
3. API integration tests for touched routes/importer behavior, especially auth and cache boundaries.
4. Focused coverage follow-up when the repo-wide threshold is strict or the change added new conditional flows.
5. Full verification command (`npm run verify`) after user review and acceptance.
6. Scoped mutation run for meaningful backend logic.

Do not claim behavior is verified unless the check actually exercised it.
When a production platform behavior cannot be reproduced locally, add the smallest regression test that proves the repo-side contract the platform depends on, and document that contract near the affected runtime files.

## CI

Pull requests against `main` trigger a GitHub Actions workflow that runs `npm run verify`. The workflow grants `contents: read`, stops after 30 minutes, and cancels an older verification run for the same pull request when a newer commit arrives. Its checkout and Node setup actions are pinned to immutable official release SHAs; Dependabot updates those pins weekly. The build must pass before review and merge.

The weekly `Dependency Audit` workflow can also be started manually. It installs the locked dependency tree and runs `npm audit --audit-level=high`, including development dependencies, without production secrets or an application build. A failed scheduled run is the owner-facing signal to inspect the advisory and decide whether to update, constrain, or document the affected dependency. The production migration workflow remains separately serialized and non-cancelled.
Pushes to `main` trigger the `Production Migration` workflow, which first checks whether production has pending SQL migrations, then backs up and migrates only when needed. That job is intended to be selected as a Vercel Deployment Check before production auto-promotion.

The scheduled or manually dispatched `Weekly LIPAS Import` workflow runs only on `main`, shares the production database concurrency group, backs up the database, imports with new parks hidden, and mentions only `@maestor` in review issues. Integration tests use a temporary SQLite database and simulated upstream/GitHub HTTP responses to prove quiet repeat runs, transactional notification persistence, retry delivery and duplicate prevention. They do not send real notifications; GitHub email delivery depends on the owner's notification settings. See [weekly LIPAS automation](./importing.md#weekly-lipas-automation).

The Vitest `testTimeout` is raised to 20 seconds because full-catalog importer integration tests insert 148 fixture records per test and can exceed the 5-second default on constrained CI runners even though they finish in well under a second locally.
