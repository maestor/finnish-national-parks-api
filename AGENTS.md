# Agent Guide

This repository is a local-first TypeScript API that imports Finnish national park catalog data, stores it in an owned database, and exposes it for a personal map application.

## Shared Skills
- Use `$project-documentation` when updating `README.md`, `docs/**`, contributor guidance, or repository workflow docs.
- Use `$git-pr-workflow` for the standard branch, review, final-verify, commit, push, and PR-notes flow.
- When using `$git-pr-workflow`, create or switch to the correct work branch before making any file edits.

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
- Update `docs/DEVELOPMENT.md` when local development, importer, database, or deployment workflow changes.
- Update `docs/TESTING.md` when test strategy, commands, or quality gates change.
- When adding, removing, or changing API endpoints, request or response fields, or database schema, update the relevant README endpoint lists and docs references in the same session.
- Prefer linking to source documents instead of duplicating long explanations.

## Data Rules
- Use LIPAS as the machine-readable source for national park catalog data.
- Use Luontoon URLs only as official external references.
- Do not scrape or republish Luontoon page content unless a future decision explicitly revisits licensing and terms.
- The importer must filter LIPAS records to active national parks and exclude contact email, phone number, and comment text from stored catalog data.
- Personal notes and visit history are owned local data and must survive catalog re-imports.
- Normal API reads must use the local or Turso database, not live LIPAS calls.

## API Contract Rules
- Define response and request schemas at the contract source before implementing handlers.
- Keep runtime responses, generated OpenAPI, tests, and future clients in sync.
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
- `npm run verify` is the main local quality gate.
- Keep coverage thresholds high from the start for first-party application code, with explicit exclusions for generated or non-application files.
- Use scoped mutation testing for meaningful backend logic after normal tests pass.

## Repo-Specific Workflow Overrides
- Branches must follow the repo naming convention: `feature/<name>`, `bugfix/<name>`, `chore/<name>`, `docs/<name>`, `refactor/<name>`, or `test/<name>`.
- If the current branch is `main`, create or switch to the correct work branch before editing any files, running fixers that may write files, or staging changes.
- All changes are PR-based against `main`. Do not push directly to `main`.
- `npm run verify` must pass before any task or PR is considered ready, except for pure documentation or repo-configuration changes that cannot affect code, tests, or generated types.
- For docs-only skips, note the exception in the PR description.
- User review and explicit acceptance are required before merge.
- Keep documentation-only changes separate from implementation changes when practical.
- Do not revert user changes.
- Do not hand-edit generated files once generation exists.
- Keep changes scoped to the current request.
