# Security And Sustainability Guide

This document describes the current security and operational baseline for the API.

## Route access

- Anonymous backend reads: `GET /health`, `GET /openapi.json`, `GET /assets/logos/*`, and `/auth/*` login-control routes.
- API-key boundary: frontend-facing `/api/*` reads outside localhost.
- Admin session: all writes and admin-only reads.
- Super-admin session: `GET /api/admin/admins`, admin role changes/removal, and `POST /api/admin/invitations`.
- Local-only operations: imports, migrations, backups, and repair commands.

The frontend may present catalog and visit reads without login, but it reaches the backend through its server-side API-key boundary. Do not call a backend route public unless its middleware and tests prove that access.

## Authentication

Google ID tokens are verified locally with `jose` against the fixed Google JWKS endpoint. Verification requires a valid `RS256` signature, Google issuer, configured audience, current expiry, non-empty subject, and `email_verified === true`. JWKS retrieval and authorization-code exchange have 10-second timeouts; the one-use authorization code is not retried.

Admin access requires the verified Google email and stable Google `sub` to match `admins`. Migration `0030_admin_google_sub.sql` adds the nullable unique subject column. An email-only row does not grant normal login access.

Migration `0032_admin_super_admin.sql` adds the `super_admin` flag, defaulting to false. Super-admin authorization is resolved from the current database row, so role changes apply to the next protected request. Super admins can list, promote, demote, or remove other admins; self-modification is rejected. Removing an admin deletes the allowlist row and blocks future login, but an already-issued stateless session can still reach ordinary admin routes until its 24-hour expiry. Admin invitations use the same super-admin boundary.

Enrolled super admins can create an invitation with `POST /api/admin/invitations`. The email is normalized and validated syntactically; Google account existence is checked only when the recipient completes OAuth. Migration `0031_admin_invitations.sql` stores only a SHA-256 token hash. Each link is private, single-use, valid for 30 minutes, and revokes an earlier pending invitation for the same email. Acceptance requires an exact match with the verified Google email, then atomically binds an email-only row or inserts a new admin before issuing the normal session.

Sessions are HS256 JWTs with a 24-hour lifetime, issuer `reissuvihko-api`, audience `reissuvihko-ui`, and role `admin`. The `__session` cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production. Admin and private responses use `Cache-Control: private, no-store`.

The frontend must independently validate session issuer, audience, expiry, and admin role before proxying admin operations. OAuth/session failures fail closed.

## Logging

Logs use an allowlist of diagnostic fields. They must not contain provider URLs, API keys, free-text location queries, cookies, authorization values, invitation tokens, or share identifiers.

Geoapify diagnostics contain only the fixed operation, status when available, elapsed duration, timeout budget, and safe error category. Request logs use route templates for tokenized paths, and unhandled errors use safe categories instead of raw messages.

Restrict log access and retention to operational roles. Treat any confirmed historical credential exposure as an incident and rotate the affected credential through the provider and deployment secret store.

## Storage and uploads

- Keep R2 private and use presigned URLs for non-public media.
- Validate limits against stored-object metadata, not only client-declared metadata. Direct-upload completion requires a positive integer stored size no greater than 15 MiB; missing or invalid metadata returns `422`, while an oversized stored object returns `413` and creates no image row.
- A direct-upload object key is a parent-scoped completion identity. Retrying the same completion returns the original image with `200` and fresh read URLs; a first successful completion returns `201`. The database enforces this identity and atomically admits no more than six trip-stop images.
- Before applying migration `0034_image_completion_identity.sql` to an existing database, run `npm run db:check-image-duplicates`. It is read-only and exits nonzero with every duplicate parent/key group, its ordering, and featured-image references. Repair any reported group manually before migrating; do not delete ambiguous rows automatically.
- Keep upload and object-retention limits documented so bandwidth and storage remain predictable.
- Do not remove media based only on absence from ordinary image rows; published review snapshots can still reference frozen image keys.

## External services

Normal reads use the owned database rather than live upstream catalog requests. Geoapify is limited to the trip-planner operations, remains server-side, uses short timeouts, reuses identical requests in process, and returns `503` when unavailable. Public provider work uses an atomic shared libSQL/Turso budget with separate per-client suggestion, route, and nearby limits plus a provider-wide daily credit ceiling. Two-point route searches reserve five credits to cover geocoding plus the routing API's long-distance surcharge; public multi-leg routes reserve five per leg; suggestions and nearby searches reserve one. The paired UI proxy counts and caps planner request bodies at 16 KiB before buffering; the API repeats the declared-size guard. Confirm the daily limit and edge rules against the provider subscription before production exposure.

## Deployment requirements

- Vercel must use a remote Turso database and must not use `MEMORY_STORAGE=true`.
- Keep `API_KEY`, database credentials, OAuth secrets, and `GEOAPIFY_API_KEY` server-side.
- Run the production migration workflow before promoting code that requires a new schema migration.
- Back up Turso before high-risk imports, migrations, or bulk admin changes.
- After migrations `0030`–`0032`, ensure every existing admin is enrolled and promote the first independently confirmed super admin with the documented SQL procedure. Use direct SQL only for bootstrap or emergency recovery.

## Contributor checklist

For changes to auth, routes, uploads, caching, storage, or external integrations:

1. Define the route access class and cache policy.
2. Add an integration test for the authentication and failure boundary.
3. Keep Zod/OpenAPI, runtime behavior, generated UI types, and documentation aligned.
4. Keep secrets, tokens, personal data, and upstream request details out of logs.
5. Record remaining risks as current rules or tracked follow-up work, not as implementation diaries.
