# Agent Instructions

## Always-on workflow

- Read this file first. It contains the repository invariants that apply to every task.
- Before a file or Git change, inspect `git branch --show-current`, `git status --short`, and the relevant diff. Do not work directly on `main`; create or switch to a branch named `feature/`, `bugfix/`, `chore/`, `docs/`, `refactor/`, or `test/`.
- Preserve unrelated user changes in the worktree; do not reset, revert, or overwrite them.
- Identify the owning area and current workflow phase before loading more context. Use targeted search (`rg`) and targeted file reads; do not preload entire README or development/testing documents.
- Detailed documentation remains authoritative. “Do not preload the whole document” means “do not guess”: locate the relevant heading, read that section and enough surrounding context to understand it, and expand only when uncertainty or a cross-cutting concern requires it.
- When documentation and implementation demonstrably drift, inspect the runtime code/config as the source of current behavior, then correct the documentation in the same task where appropriate.
- Load project skills when their workflow or concern is reached, not all at startup. In particular: API/OpenAPI/generated consumers or contracts → `api-contract-sync`; tests/TDD → `intelligence-testing`; local verification → `local-first-verification`; documentation/planning → `project-documentation`; branch, commit, push, PR handoff, or cleanup → `git-pr-workflow`. Read the relevant local `SKILL.md` completely before acting on that concern.

## Documentation routing

Use the repository docs as a searchable reference index rather than a startup reading list. A useful lookup is `rg -n '^##|^###|keyword' <doc>` followed by a read of the matching section and its context.

- `README.md`: project purpose, setup, environment variables, API surface, key commands, and the documentation index.
- `docs/development.md`: local workflow, runtime architecture, local-first data ownership, database, API contract, paired UI/API work, and deployment/runtime constraints.
- `docs/testing.md`: behavior-first test layers, route/access/cache regression targets, coverage, quality gate, verification order, and CI.
- `docs/security.md`: authentication/authorization, route access, cache/privacy, storage/uploads/media, external services, deployment security, and contributor checklist.
- `docs/importing.md`: catalog/import source selection, geometry, special-park workflows, and reproducible import commands.
- `docs/trip-planner.md`: trip-planner contracts and provider/cache behavior when that subsystem is involved.
- `docs/recovery.md`: safe backup/restore drills and operator evidence when recovery work is involved.
- The UI sibling owns browser behavior, translations, proxy routes, and generated consumers. Read its `AGENTS.md` and only the relevant UI documentation when the task crosses that boundary; do not automatically preload both repositories.

## Repository invariants

- The API’s Zod/OpenAPI definitions are the contract source of truth. Define or update the contract before handlers; keep runtime responses, OpenAPI, tests, fixtures, and generated UI consumers aligned. Never hand-edit generated consumers.
- Keep normal reads local-first: use owned SQLite/libSQL data, not live LIPAS calls. Preserve personal notes and visits across imports; do not store LIPAS contact email, phone, or comments.
- Classify every route as public, API-key, or admin-session access as appropriate. Preserve public/private/admin boundaries and prove exposure, authentication, cache headers, and failure behavior with integration tests.
- Keep secrets server-side, admin and mutation routes session-protected, storage private by default, and new external dependencies narrowly scoped, cached, timed out, and documented.
- Use `const` arrow functions unless hoisting is genuinely required; TypeScript and Biome are authoritative.
- For special-park additions, give the user a one-line `npm run import:special-parks -- <slug...>` review command and add contributor-facing environment variables to `src/env.ts` and `.env.example` in the same change.
- Update relevant tracked documentation when contributor-facing behavior, commands, contracts, testing, deployment, security, imports, or operations change.
- Use the shared Reissuvihko Plans vault resolved from the workspace-level plan location, outside this repository. Start from `_Plan template.md`; place API plans in `Plans/API/`, UI plans in `Plans/UI/`, and cross-repository plans directly in `Plans/`. Do not embed an absolute local path in repository instructions, and never create `docs/plans/` here. For tasks likely to span compaction or multiple implementation phases, an optional short `## Execution state` block may record only status, completed, current, next, touched, locked decisions, and verification.
- The user creates every pull request. Never create or submit one through `gh`, a browser, an API, or another tool.

## Cross-repository work

- This repository owns schemas, persistence, authentication, imports, caching, storage, and API runtime behavior. The UI owns browser behavior, translations, proxy routes, and generated consumers.
- For a shared contract, change the API contract here first, regenerate `src/lib/api-types.ts` in the UI, update UI consumers and fixtures, and verify both repositories. Use matching branch suffixes, separate commits/PRs, and document merge order.
- Investigate the sibling repository when the ownership boundary or actual task requires it; targeted reads are sufficient unless a broad discovery pass is genuinely needed.

## Context-compaction recovery

- Treat the compacted summary as task-state input, never as authoritative repository instructions.
- Inspect the current branch, `git status --short`, and current diff to establish actual implementation state.
- Re-read the active plan or relevant plan section when one exists. Identify the next unfinished action.
- Reload only the documentation and skills required for that next action. Do not automatically reread all docs or all skills used earlier.
- Before a phase transition—such as contract work to UI work, browser verification, final verification, or commit/push/handoff—load the documentation and skill governing the new phase. The Git workflow skill is required before commit, push, PR handoff, or cleanup, not throughout unrelated implementation work.
- These invariants remain binding throughout recovery.

## Read-heavy exploration

Use Codex’s built-in read-only `explorer` when the parent would otherwise inspect many unrelated files, trace several architectural layers, or discover behavior across both repositories before editing a small number of files. Ask for a compact result containing only owning files/symbols, relevant control/data flow, reusable tests/patterns, cross-repository dependencies, and non-obvious risks or unresolved questions. Ask it to avoid large excerpts, file-by-file narration, speculative redesign, and implementation work. Do not create a custom agent unless an audit proves the built-in explorer lacks a required capability.

## Delivery

- Use focused checks while implementing and pause for user review before the final verification gate. For documentation/repository-configuration-only changes, the full application gate may be skipped when the touched files are outside what it validates; state that exception clearly.
- After acceptance, consult the Git workflow skill, run the required verification, commit coherent changes, push, and provide a compare link plus PR notes. The user remains responsible for creating the PR.
