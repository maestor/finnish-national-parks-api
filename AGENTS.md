# Agent Instructions

## Start of Session

Before investigating, planning, editing, or running code:

1. Read `README.md`, `docs/development.md`, and `docs/testing.md` fully. Read `docs/security.md` for auth, caching, uploads, storage, secrets, external integrations, or deployment work.
2. Read the relevant local skill before acting, especially `api-contract-sync`, `intelligence-testing`, `local-first-verification`, `project-documentation`, and `git-pr-workflow`.
3. For a file or Git change, check the branch and work only on an explicit target branch or a new branch using `feature/`, `bugfix/`, `chore/`, `docs/`, `refactor/`, or `test/`.

The README and `docs/` are the source of truth for detailed development, import, security, test, and deployment guidance. Do not duplicate them here.

## Shared Plans Vault

- Use `/Users/maestor/Projects/Documentations/Reissuvihko/Plans/` for every new product, technical, research, and cross-repository plan; start from `_Plan template.md`.
- Put API-only plans in `Plans/API/`, UI-only plans in `Plans/UI/`, and cross-repository or non-repository plans directly in `Plans/`.
- Never create `docs/plans/` in this repository. Move any misplaced plan to the vault before continuing.

## Repository Rules

- Use `const` arrow functions unless hoisting is genuinely required; TypeScript and Biome are authoritative.
- Keep normal reads local-first: use owned SQLite/libSQL data, not live LIPAS calls. Preserve personal notes and visits across imports; do not store LIPAS contact email, phone, or comments.
- Define schemas at the contract source before handlers. Keep runtime responses, OpenAPI, tests, and generated UI consumers in sync. Classify every route's access explicitly; prove exposure, auth, cache, and failure behavior with integration tests.
- Keep secrets server-side, admin and mutation routes session-protected, storage private by default, and new external dependencies narrowly scoped, cached, timed out, and documented.
- For special-park additions, give the user a one-line `npm run import:special-parks -- <slug...>` review command. Add contributor-facing environment variables to `src/env.ts` and `.env.example` in the same change.
- Update the relevant tracked documentation with contributor-facing changes. Do not hand-edit generated consumers.

## Cross-Repository Work

- Read the UI repository's `AGENTS.md` and relevant development/testing guides first.
- This repository owns schemas, persistence, authentication, imports, caching, storage, and API runtime behavior; the UI owns browser behavior, translations, proxy routes, and generated consumers.
- Change the contract here first, then regenerate `src/lib/api-types.ts` in the UI, update consumers and fixtures, and verify both repositories. Use matching branch suffixes, separate PRs, and document merge order.

## Delivery

- Do not work directly on `main`, revert user changes, or hand-edit generated files.
- Use focused checks while implementing. Pause for review before the final gate; after acceptance, run `npm run verify` unless the change is documentation/repository configuration only, then note that exception in the PR.
- After acceptance and verification, commit with the Git workflow, push, and provide a PR link and notes.
