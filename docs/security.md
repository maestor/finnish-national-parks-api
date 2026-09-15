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
- Direct browser PUTs target parent-scoped temporary keys. Completion reads the stored object, limits decoding to 40 megapixels, applies orientation, strips EXIF/GPS metadata, and creates separate server-owned JPEG full (maximum 2,560 px) and thumbnail (maximum 480 px; 150 KiB quality budget) keys. The temporary key is separately persisted as the parent-scoped completion identity, so a retry returns the original image with `200` and fresh read URLs even after staging cleanup; a first successful completion returns `201`. The database enforces that identity and atomically admits no more than six trip-stop images.
- Before applying migration `0034_image_completion_identity.sql` to an existing database, run `npm run db:check-image-duplicates`. It is read-only and exits nonzero with every duplicate parent/key group, its ordering, and featured-image references. Repair any reported group manually before migrating; do not delete ambiguous rows automatically.
- Apply `0035_image_derivative_upload_identity.sql` and `0037_media_upload_processing_claim.sql` before deploying the image-processing completion handler. Completion claims each staged upload with a durable fencing token and publishes to unique derivative keys, so concurrent retries cannot overwrite the committed image. Before production promotion, prove one disposable direct upload through the deployed R2/Vercel runtime; local Sharp tests do not establish function memory or duration limits.
- `npm run media:convert-existing-images` converts photos uploaded before thumbnail support into a normal-size JPEG and a thumbnail. It keeps the old source image initially and does not delete anything. The separate source-file cleanup below can remove that old copy only after checking published review snapshots.
- Keep upload and object-retention limits documented so bandwidth and storage remain predictable.
- Do not remove media based only on absence from ordinary image rows; published review snapshots can still reference frozen image keys.

### Convert existing images

Run this only after the image-processing handler and migration are deployed. One command converts all older images that still need a thumbnail. It works through images in small groups so it does not try to hold the whole library in memory, but you run the command only once. Each finished image is saved immediately.

The database must already be current. The preview and `--apply` command validate migration readiness but never apply migrations; run the separate migration workflow first when they report pending files.

1. Start with a preview. It writes nothing and reports every older image that still needs conversion:

   ```sh
   npm run media:convert-existing-images
   ```

2. If the preview has no failures, run this once to convert everything remaining:

   ```sh
   npm run media:convert-existing-images -- --apply
   ```

3. A successful conversion result has `"status":"complete"` and says, in plain text, that all existing images now have a normal-size image and a thumbnail. Its `imagesConverted` value is the number converted in that run. No further command is needed.

4. Transient R2 connection faults, including `ssl/tls alert bad record mac`, are retried automatically four times: immediately, then after 250 ms and 1 second. A retry that succeeds continues the same one-command run without operator action.

5. If the conversion run still reports a failure, it exits nonzero. Wait briefly and run the exact same command again:

   ```sh
   npm run media:convert-existing-images -- --apply
   ```

   The command starts its internal scan again, skips every image it already converted, and retries the first unfinished image. There is no recovery token to copy or manage.

The preview result uses `imagesToConvert` for the number of images it would convert. The conversion result uses `imagesConverted` for the number it converted. Both list any `problems` and report original and new-image byte totals. The conversion itself keeps every old source image; the separate cleanup below decides whether it can later be removed.

### Remove old conversion source files

Run this only after the existing-image conversion has completed successfully. It is a one-time storage cleanup for the old root image files that M1 kept alongside the new normal-size image and thumbnail. It does **not** remove either current image size.

The database must already be current. This preview and its `--apply` operation never apply pending migrations.

1. Start with a preview. It scans all visit and trip-stop image folders internally, identifies only files created by the completed M1 conversion, and checks every published year-review and date-range-review snapshot:

   ```sh
   npm run media:remove-converted-originals
   ```

2. Review `oldSourceImagesToRemove` and `oldSourceImageBytesToRemove`. `publishedReviewProtectedSourceImages` means an old source is still needed by a published review, so it will be kept. `alreadyRemovedSourceImages` means a prior run has already removed the file. The preview changes nothing.

3. If the preview has no `problems` and the totals look expected, run the same command with permission to remove only those old source files:

   ```sh
   npm run media:remove-converted-originals -- --apply
   ```

4. A successful result has `"status":"complete"`. It reports `removedSourceImages`; the normal-size images and thumbnails remain in place. If R2 has a short-lived connection failure, the command retries automatically. If it still reports a problem, wait briefly and run the exact same command again. Already removed files are recognized, so it is safe to repeat.

This command is intentionally separate from `media:cleanup-unused-images`: the latter protects all current image source keys, while this command has the narrower job of retiring only M1 source files that current content no longer serves and published snapshots do not use.

## Remove unused image files safely

Deleting an image, visit, trip stop, or trip removes it from the application immediately. Its stored image files are recorded for delayed cleanup instead of being deleted during the user request. This preserves a recovery window and means a temporary R2 failure never makes a successful user deletion fail unpredictably.

Run the review command from a trusted operator machine with the production database and restricted R2 credentials:

The database must already be current. This preview and its `--apply` operation never apply pending migrations; apply schema changes through the separate migration workflow first.

```sh
npm run media:cleanup-unused-images
```

It scans only `visits/` and `trip-stops/`, ignores files newer than eight days, protects active uploads and image keys in current rows or published review snapshots, and prints `imagesToDelete` plus `unusedImageBytes`. It does not delete anything by default. Review that report before applying the exact same command:

```sh
npm run media:cleanup-unused-images -- --apply
```

The command paginates its whole scan internally; there is no position token to copy. It rechecks references immediately before each deletion. Storage failures are recorded in the database and retried by the next normal run. Never lower the eight-day minimum, delete a whole bucket, or use this command before a current recovery drill confirms the backup and media-recovery controls.

Run a preview after bulk imports or large deletions and at least monthly. Production deletion remains an operator review step; no automatic bucket lifecycle rule may delete finalized media based only on age.

## External services

Normal reads use the owned database rather than live upstream catalog requests. Geoapify is limited to the trip-planner operations, remains server-side, uses short timeouts, reuses identical requests in process, and returns `503` when unavailable. Public provider work uses an atomic shared libSQL/Turso budget with separate per-client suggestion, route, and nearby limits plus a provider-wide daily credit ceiling. Two-point route searches reserve five credits to cover geocoding plus the routing API's long-distance surcharge; public multi-leg routes reserve five per leg; suggestions and nearby searches reserve one. The paired UI proxy counts and caps planner request bodies at 16 KiB before buffering; the API repeats the declared-size guard. Confirm the daily limit and edge rules against the provider subscription before production exposure.

## Deployment requirements

- Vercel must use a remote Turso database and must not use `MEMORY_STORAGE=true`.
- Keep `API_KEY`, database credentials, OAuth secrets, and `GEOAPIFY_API_KEY` server-side.
- Run the production migration workflow before promoting code that requires a new schema migration.
- Back up Turso before high-risk imports, migrations, or bulk admin changes.
- The migration workflow artifact is not evidence of recurring backup or media recovery. Run the isolated local database drill in [docs/recovery.md](./recovery.md) and record the required Turso, R2, GitHub, and Vercel evidence before claiming recovery coverage.
- After migrations `0030`–`0032`, ensure every existing admin is enrolled and promote the first independently confirmed super admin with the documented SQL procedure. Use direct SQL only for bootstrap or emergency recovery.

## Contributor checklist

For changes to auth, routes, uploads, caching, storage, or external integrations:

1. Define the route access class and cache policy.
2. Add an integration test for the authentication and failure boundary.
3. Keep Zod/OpenAPI, runtime behavior, generated UI types, and documentation aligned.
4. Keep secrets, tokens, personal data, and upstream request details out of logs.
5. Record remaining risks as current rules or tracked follow-up work, not as implementation diaries.
