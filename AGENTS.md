# Agent Guide

This repository is for a local-first TypeScript API that imports Finnish national park catalog data, stores it in an owned database, and exposes it for a future personal map application.

## Code Style

- Prefer `const fn = () => {}` arrow functions over `function fn() {}` declarations for all top-level module functions.
- `function` declarations are only acceptable when hoisting is genuinely required.
- Biome handles formatting and linting; `npm run lint:fix` applies fixes automatically.

## Intended Stack

- TypeScript on Node.js.
- Hono for HTTP routing.
- Zod-derived schemas and OpenAPI for API contracts.
- Drizzle ORM with `@libsql/client`.
- Local SQLite/libSQL first through `DATABASE_URL=file:./data/local.db`.
- Production target is Vercel Functions with Turso.
- Keep the database layer compatible with local SQLite/libSQL and remote Turso by configuration rather than later rewrites.

## Documentation Rules

- Update `README.md` when project purpose, setup, or common commands change.
- Update `docs/DEVELOPMENT.md` when local development, importer, database, or deployment workflow changes.
- Update `docs/TESTING.md` when the test strategy, commands, or quality gates change.
- **When adding, removing, or changing API endpoints, request/response fields, or database schema, update `README.md` endpoint lists and `docs/DEVELOPMENT.md` / `docs/TESTING.md` references in the same session.** Do not wait for a separate request to sync documentation.
- Prefer linking to source documents instead of duplicating long explanations.

## Data Rules

- Use LIPAS as the machine-readable source for national park catalog data.
- Use Luontoon URLs only as official external references.
- Do not scrape or republish Luontoon page content unless a future decision explicitly revisits licensing and terms.
- The importer must filter LIPAS records to active national parks and exclude contact email, phone number, and comment text from stored catalog data.
- Personal notes and visit history are owned local data and must survive catalog re-imports.
- Normal API reads must use the local/Turso database, not live LIPAS calls.

## API Contract Rules

- Define response/request schemas at the contract source before implementing handlers.
- Keep runtime responses, generated OpenAPI, tests, and any future clients in sync.
- Prefer additive API changes unless a breaking change is intentional and documented.
- Lightweight list endpoints should not include full boundary geometry by default.
- Keep public catalog endpoints separate from personal note and visit endpoints so catalog responses can be cached aggressively.
- Catalog `GET` endpoints should support deterministic ETags and `304 Not Modified`.

## Testing Rules

- Follow behavior-first TDD for application code.
- Start with the highest-signal failing test that proves real behavior.
- Prefer API integration tests through the HTTP boundary with a temporary database for route, persistence, and importer behavior.
- Use focused unit tests for pure mapping and geometry calculations.
- Run local verification in the cheapest meaningful order, then escalate only when the lower-cost check cannot prove the touched behavior.
- Provide `npm run verify` as the main local quality gate. It must run at least typecheck and coverage tests.
- Keep coverage thresholds high from the start for first-party application code, with explicit exclusions for generated or non-application files.
- Use scoped mutation testing for meaningful backend logic after normal tests pass, especially importers, mappers, validation, persistence, and API contract behavior.

## Git And Change Hygiene

- **PR-based workflow:** All changes must be developed on a dedicated branch (`feature/<name>`, `bugfix/<name>`, `chore/<name>`, `docs/<name>`, etc.) and submitted as a pull request against `main`. Do not push directly to `main`.
- **Commit conventions:** Use meaningful, independent commits with descriptive prefixes:
  - `Feature:` — new behavior or endpoints
  - `Fix:` — bug fixes
  - `Chore:` — tooling, dependencies, config
  - `Docs:` — documentation updates
  - `Refactor:` — code restructuring without behavior change
  - `Test:` — test-only changes
- A single PR may contain multiple commits.
- **Quality gate:** `npm run verify` must pass before any task or PR is considered ready. The only exception is changes that are entirely outside what `verify` validates — for example, pure documentation updates (README, DEVELOPMENT, TESTING, AGENTS, plans) or repository configuration that does not affect code, tests, or types. In those cases, skip `verify` and note the exception in the PR description.
- **Review requirement:** User review and explicit acceptance are required before merging.
- Keep documentation-only changes separate from implementation changes when practical.
- Do not revert user changes.
- Do not hand-edit generated files once generation exists.
- Keep changes scoped to the current request.
