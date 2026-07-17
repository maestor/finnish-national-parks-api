# Agent Guide

This repository is a local-first TypeScript API that imports Finnish park, protected-area, and nature-trail catalog data, stores it in an owned database, and exposes it for a personal map application.

## Code Style
- Prefer `const fn = () => {}` arrow functions over `function fn() {}` declarations for top-level module functions.
- `function` declarations are acceptable only when hoisting is genuinely required.
- Biome handles formatting and linting; `npm run lint:fix` applies fixes automatically.

## Intended Stack
- TypeScript on Node.js.
- Hono for HTTP routing.
- Zod-derived schemas and OpenAPI for API contracts.
- Drizzle ORM with `@libsql/client`.
- Local SQLite or libSQL first through `DATABASE_URL=file:./data/local.db`.
- Production target is Vercel Functions with Turso.

## Documentation Rules
- Update `README.md` when project purpose, setup, or common commands change.
- Update `docs/development.md` when local development, importer, database, or deployment workflow changes.
- Update `docs/security.md` when auth policy, secrets handling, storage upload behavior, cache exposure, external request-path dependencies, or operational hardening priorities change.
- Update `docs/testing.md` when test strategy, commands, or quality gates change.
- When adding, removing, or changing API endpoints, request or response fields, or database schema, update the relevant README endpoint lists and docs references in the same session.
- When implementing user-requested special-park additions, always offer a copy-pasteable one-line `npm run import:special-parks -- <slug...>` command covering the new slugs so the user can import and review the batch before final acceptance.
- If docs mention a contributor-facing env var, it must also exist in `src/env.ts` and `.env.example` in the same change.
- Prefer linking to source documents instead of duplicating long explanations.

## Data Rules
- Use LIPAS as the machine-readable source for park, protected-area, and nature-trail catalog data.
- Prefer Luontoon as the first official external reference for `parkUrl` when a clearly matching park or destination page exists.
- If no suitable Luontoon page exists for `parkUrl`, use another clearly suitable official page such as a municipality, park, or route page instead of inventing a destination URL.
- Do not scrape or republish Luontoon page content unless a future decision explicitly revisits licensing and terms.
- The importer must filter LIPAS records to active supported catalog types, exclude contact email, phone number, and comment text from stored catalog data, and skip `4404` nature trails whose full route geometry is contained inside an imported area or whose normalized `locationLabel`, `postalCode`, and `postalOffice` exactly match an imported area.
- Personal notes and visit history are owned local data and must survive catalog re-imports.
- Normal API reads must use the local or Turso database, not live LIPAS calls.

## API Contract Rules
- Define response and request schemas at the contract source before implementing handlers.
- Keep runtime responses, generated OpenAPI, tests, and future clients in sync.
- Prefer additive API changes unless a breaking change is intentional and documented.
- Lightweight list endpoints should not include full boundary geometry by default.
- Keep public catalog endpoints separate from personal note and visit endpoints so catalog responses can be cached aggressively.
- Catalog `GET` endpoints should support deterministic ETags and `304 Not Modified`.
- Every route must have an explicit access classification: anonymous remote, API-key protected, admin-session protected, or local-only maintenance.
- Do not describe a route as public in docs unless middleware and tests prove anonymous remote access.
- New anonymously accessible endpoints must define cache policy, abuse-control expectations, and the reason they are safe to expose without API-key or session auth.

## Security And Sustainability Rules
- Prefer owned data and local verification over new live third-party request-path dependencies. If a live dependency is necessary, document its timeout, caching, and failure behavior.
- Never expose the shared `API_KEY` in browser-delivered code.
- Browser-facing admin or mutation routes must use session-based admin authorization.
- `GET /api/admin/parks/visibility` is an admin-only read route and must stay session-protected.
- Treat direct uploads as a cost and abuse surface: enforce limits against the actual stored object, not only client-declared metadata.
- Keep storage private by default and prefer presigned URLs over permanently public buckets.
- Before high-risk imports, schema changes, or large manual data operations against Turso, take a fresh backup or document why it is unnecessary.
- When changing auth, cacheability, uploads, or external integrations, update the relevant tests and `docs/security.md` in the same session.

## Testing Rules
- Follow behavior-first TDD for application code.
- Start with the highest-signal failing test that proves real behavior.
- Prefer API integration tests through the HTTP boundary with a temporary database for route, persistence, and importer behavior.
- Use focused unit tests for pure mapping and geometry calculations.
- Run local verification in the cheapest meaningful order, then escalate only when the lower-cost check cannot prove the touched behavior.
- `npm run verify` is the main local quality gate.
- Keep coverage thresholds high from the start for first-party application code, with explicit exclusions for generated or non-application files.
- Use scoped mutation testing for meaningful backend logic after normal tests pass.
- When route exposure changes, add integration coverage for the exact auth boundary, cache headers, and failure path.
- When upload behavior changes, cover both client-declared limits and actual stored-object validation.

## Mandatory Git Workflow

**Never edit, stage, commit, or push directly on `main`.** All changes must go through a working branch and a pull request.

### Before any edits
1. Check the current branch with `git branch --show-current`.
2. If on `main`, create and switch to a working branch first.
3. Branch naming convention:
   - `feature/<name>`
   - `bugfix/<name>`
   - `chore/<name>`
   - `docs/<name>`
   - `refactor/<name>`
   - `test/<name>`
4. Only after confirming you are on a working branch may you edit files.

### Anti-patterns
- Starting implementation on `main`.
- Running fixers or generators that write files while on `main`.
- Staging or committing while on `main`.
- Treating targeted tests as a substitute for the final verify gate.
- Running final verify before the user has reviewed the batch.
- Skipping the review pause before the final verification gate.
- Building one giant end-of-task commit when the work had obvious batch boundaries.

### During implementation
- Implement in coherent batches.
- Use targeted checks (focused tests, typecheck, lint) while working.
- Do not run the full `npm run verify` gate until after user review.

### Review pause
- After finishing a batch, summarize the change and pause for user review.
- Wait for explicit acceptance before proceeding to the final gate.
- Treat a brief approval after that pause, such as `done`, `looks good`, `approved`, or equivalent acceptance, as authorization to continue the remaining workflow steps unless the user explicitly says to stop before verify, commit, or push.

### Final verification and delivery
1. Run `npm run verify` after user acceptance.
2. Fix any failures and rerun until it passes.
3. Commit in coherent batches with prefixes: `Feature:`, `Fix:`, `Docs:`, `Chore:`, `Refactor:`, or `Test:`.
4. Push the branch.
5. Provide a clickable GitHub compare link and copy-pasteable PR notes.

### Docs-only exception
Docs-only or workflow-only changes may skip the full verify gate when the touched files are limited to documentation or repo workflow text. Note the exception in the PR description.

## Delivery Rules
- User review and explicit acceptance are required before merge.
- Keep documentation-only changes separate from implementation changes when practical.
- Do not revert user changes.
- Do not hand-edit generated files once generation exists.
- Keep changes scoped to the current request.
