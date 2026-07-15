# Security And Sustainability Guide

This document defines the security and operational sustainability baseline for future development in this repository.

It is intentionally policy-oriented. Keep it focused on standing rules, design expectations, and contributor checklists rather than dated audit notes.

## Core Principles

- Prefer owned data, local persistence, and deterministic cache behavior over live upstream dependencies on normal read paths.
- Keep the smallest possible anonymous surface.
- Treat browser-facing admin actions as session-authorized operations, not shared-secret operations.
- Keep storage private by default and expose files through presigned URLs instead of permanently public buckets.
- Treat bandwidth, object storage growth, backup hygiene, and third-party dependency load as part of security and sustainability, not separate follow-up work.

## Route Access Policy

Every route must fit one explicit access class:

- Anonymous remote:
  Only `GET /health`, `GET /openapi.json`, and login-control `/auth/*` routes belong here unless a future change is explicitly designed, tested, and documented otherwise.
- API-key integration:
  Read-only `/api/*` routes that are intentionally available to trusted non-browser callers may use the shared `API_KEY`.
- Admin session:
  All write routes and admin-only read routes must require a valid admin session cookie.
- Local-only maintenance:
  Imports, migrations, backups, and one-off repair workflows should stay in CLI or operator tooling rather than becoming HTTP endpoints.

Rules:

- Do not describe a route as public unless it is anonymously accessible over the network.
- `/api/public/*` naming refers to frontend-facing payload shape, not anonymous access.
- New anonymously accessible routes must define cache policy, abuse controls, and the reason they are safe to expose.
- Removing an unused admin endpoint is preferred over leaving it available behind auth.

## Auth And Session Rules

- Never expose the shared `API_KEY` in browser-delivered code.
- Browser-facing admin or mutation flows must use Google-backed admin sessions.
- If OAuth/session auth is unavailable, admin-session routes should fail closed rather than silently downgrading to weaker auth.
- When auth policy changes, update runtime enforcement, route contracts, integration tests, `README.md`, `docs/DEVELOPMENT.md`, and this file in the same change.
- When a route mixes API-key and session requirements, document both clearly in contract and contributor docs.

## Storage And Upload Rules

- Keep R2 private by default.
- Use presigned URLs for visit images, park logos, and similar assets instead of public bucket URLs.
- Enforce upload limits against the actual stored object metadata, not only client-declared metadata.
- Keep a documented size budget for uploads so storage growth and bandwidth remain predictable.
- If direct uploads can create orphaned objects, define and document cleanup strategy.
- Do not require manual pre-compression or manual resizing as a normal admin workflow when the system can handle it automatically.

## External Dependency Rules

- Normal API reads must use the local or Turso database, not live LIPAS or other upstream calls.
- Avoid new live third-party request-path dependencies when local verification or cached verification is practical.
- If a live dependency is necessary on a request path, document:
  - what is called
  - timeout and retry expectations
  - cache strategy
  - failure behavior
  - test coverage for failure cases
- Prefer local JWT verification against trusted signing keys over per-request token introspection endpoints when feasible.
- `POST /api/trip-planner/search` may call Geoapify for geocoding and routing when `GEOAPIFY_API_KEY` is configured. Keep those calls behind the existing backend auth boundary, use short request timeouts, reuse identical requests through process-local in-memory caching and in-flight deduplication, and fail closed with `503` when the provider is unavailable.

## Data Handling Rules

- Preserve personal notes, visit history, and related assets across catalog re-imports.
- Keep imported catalog data and owned personal data logically separated.
- Do not store or republish unnecessary upstream personal/contact fields.
- Before high-risk imports, migrations, or bulk admin data operations against Turso, take a fresh backup or document why the operation is safely reversible.

## Operational Guardrails

- Vercel deployments must not run against local `file:` databases.
- Vercel deployments must not use `MEMORY_STORAGE=true`.
- Shared cache headers and `ETag` behavior must be deliberate for catalog and summary routes.
- Private or admin responses must use non-cacheable headers.
- New rate-sensitive anonymous flows should add edge or app-layer rate limiting before exposure.
- Add a minimal API-focused security header set when platform defaults do not already provide it.

## Contributor Checklist

When changing auth, routes, uploads, env vars, caching, storage, or external integrations:

1. Classify the route access level explicitly.
2. Verify the auth boundary with integration tests.
3. Verify cache headers and `ETag` behavior for changed `GET` routes.
4. Re-check stored-object metadata for upload flows.
5. Update all contributor-facing env docs together with `src/env.ts` and `.env.example`.
6. Remove stale endpoints, stale docs, and stale compatibility assumptions in the same change.
7. Document any remaining risk as a standing rule or follow-up task, not as a dated diary entry.
