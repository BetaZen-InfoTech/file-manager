# File Manager SaaS — Feature Summary

> A short, plain-English reference for what this project does, what's in the codebase,
> and how to run it from a blank Ubuntu VPS via a GitHub clone.
> Stack: **Next.js (App Router, Server API) + MongoDB (Mongoose) + MinIO (S3-compatible)**.

---

## ✅ Requested-points checklist (all built)

| # | Point | Where in code |
|---|-------|---------------|
| 1 | **PWA feature** | [`public/manifest.webmanifest`](public/manifest.webmanifest), [`public/sw.js`](public/sw.js), [`app/offline/page.tsx`](app/offline/page.tsx), registration in [`app/layout.tsx`](app/layout.tsx) |
| 2 | **Mobile-friendly UI** | Mobile-first Tailwind + bottom nav on small screens (admin & vendor layouts), ≥ 44 px touch targets, safe-area insets |
| 3 | **Easy server migration** | [`scripts/migrate.sh`](scripts/migrate.sh) (one command: maintenance ON → mongodump → mc mirror → DNS → maintenance OFF) |
| 4 | **Easy API system for vendor/user** | [REST routes under `/api/v1/`](app/api/v1) + [OpenAPI spec](app/api/v1/openapi/route.ts) at `/api/v1/openapi` + [Swagger UI](app/docs/page.tsx) at `/docs` + [JS SDK](examples/sdk.js) + [quickstart](examples/quickstart.md) |
| 5 | **Easy server reboot** | [`scripts/reboot-safe.sh`](scripts/reboot-safe.sh), [`ecosystem.config.js`](ecosystem.config.js) (PM2 startup + save), docker `restart: always` |
| 6 | **Easy maintenance mode (only SaaS admin can login)** | [`lib/maintenance.ts`](lib/maintenance.ts) + [`app/api/v1/admin/maintenance/route.ts`](app/api/v1/admin/maintenance/route.ts) + UI [`app/(admin)/admin/maintenance/page.tsx`](app/(admin)/admin/maintenance/page.tsx). Login endpoint checks the flag and only lets `super_admin`/`platform_staff` through. |
| 7 | **Mail configuration** | [`lib/mail.ts`](lib/mail.ts) — SMTP/Resend/SES drivers, templates for welcome / suspended / quota-warning. Env: `MAIL_DRIVER`, `MAIL_HOST`, `MAIL_FROM`, … |
| 8 | **Easy create public / private (JWT-Token-Auth) / temporary link** | [`POST /api/v1/files/:id/links`](app/api/v1/files/[id]/links/route.ts) — single endpoint, `type` chooses one of 3. Min expiry 60s, `neverExpire: true` = unlimited. |
| 9 | **File-id verify via auth → get access link** | Same endpoint. Server first runs `authenticate()` and the RBAC `can()` guard, then verifies the file belongs to the same vendor, then creates the link. UI button auto-fills file id. |
| 10 | **Reset all type of link via id access** | [`POST /api/v1/files/:id/links/reset`](app/api/v1/files/[id]/links/reset/route.ts) — optional `types[]` to scope, optional `regenerate: true` to revoke + return fresh tokens. |
| 11 | **3rd-party JWT with RBAC access** | [`POST /api/v1/jwt/issue`](app/api/v1/jwt/issue/route.ts) returns HS256 JWT with `vendorId + scopes + bucketIds + exp`. Used for `/d/:token` private downloads and authorized API calls. Revocation: [`POST /api/v1/jwt/revoke`](app/api/v1/jwt/revoke/route.ts) by `jti`. |
| 12 | **Tests — from me + real test** | [`tests/core-logic.test.js`](tests/core-logic.test.js) — 27 verified tests (links, JWT, private access, GitHub signature, suspension, RBAC, cross-tenant). `npm test` runs them. CI gate wired in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). |
| 13 | **README with full details** | [`README.md`](README.md) (quick-start + file layout + API) and this [`FEATURES.md`](FEATURES.md) (every feature mapped to code). |
| 14 | **Install process — public & private GitHub repo** | [`scripts/install.sh`](scripts/install.sh) — accepts both `https://…` and `git@github.com:…`. README §"Quick start" + FEATURES §12 walk through public + private (SSH deploy key + PAT). |

> Two additional features you asked for in follow-ups, also already in place:
> - **GitHub auto-deploy webhook** — [`app/api/v1/deploy/github/route.ts`](app/api/v1/deploy/github/route.ts) + [`scripts/deploy.sh`](scripts/deploy.sh) (Option A) and [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (Option B).
> - **Pulling + updating from a blank Ubuntu VPS** — [`scripts/install.sh`](scripts/install.sh) handles a fresh box end-to-end; subsequent updates are `git pull && npm ci && npm run build && pm2 reload filemanager` (or just push to `main`).

---

## 1. Two panels (as you asked)

| Panel | Who | Where in code |
|------|-----|---------------|
| **Admin Panel** | SaaS owner / platform staff | [`app/(admin)/admin/`](app/(admin)/admin/) |
| **Vendor Panel** | Each customer (multi-tenant) | [`app/(vendor)/dashboard/`](app/(vendor)/dashboard/) |

Both panels share the same login (`/login`). After login the user is routed by `role` —
`super_admin` and `platform_staff` → `/admin`, vendor roles → `/dashboard`.

Multi-tenant model: every document carries `vendorId` and **every query is scoped by it**,
so cross-tenant access is impossible. See [`lib/rbac.ts`](lib/rbac.ts) `can()` for the guard.

---

## 2. Each vendor creates their own buckets

- API: `POST /api/v1/buckets` (permission `bucket:create`)
- UI: Dashboard → Buckets → "New bucket"
- A bucket has: name, description, isPublic flag, allowed mime types, max file size.
- Bucket limit enforced from `vendor.limits.maxBuckets`.
- Object keys inside storage are `vendors/{vendorId}/buckets/{bucketId}/{fileId}/{name}`
  — tenant isolation right down to the storage layer.

---

## 3. API keys with RBAC scopes

- Created from Vendor Panel → API keys.
- Format: `fmsk_<32-byte-base62>` — the **plain key is shown only once** at creation.
- Only the **SHA-256 hash** of the key is stored in MongoDB.
- Each key carries:
  - `permissions[]` — RBAC scopes (e.g. `file:upload`, `file:download`, `publicurl:create`)
  - `bucketIds[]` — optional restriction to specific buckets (empty = all)
  - `expiresAt` — optional expiry
- A key never inherits the full permissions of the vendor who created it — **principle of least privilege**.
- API: `POST /api/v1/api-keys`, `GET /api/v1/api-keys`, `DELETE /api/v1/api-keys/:id`

The full scope list is in [`lib/rbac.ts`](lib/rbac.ts).

---

## 4. Files — full details saved in MongoDB

After upload, the `files` document stores:

```
originalName, storageKey, extension, mimeType, sizeBytes,
checksum: { md5, sha256 },
width, height, duration, pageCount,
thumbnails[], tags[], metadata,
isHidden, version, status,
uploadedBy, uploadSource, apiKeyId,
deletedAt, createdAt, updatedAt
```

The **upload endpoint returns `{ id, ...full details }`** in its response, exactly as you asked:

```bash
POST /api/v1/buckets/:bid/files     (multipart/form-data, field: "file")
→ {
    id, originalName, mimeType, sizeBytes, extension,
    checksum: { sha256, md5 }, bucketId, folderId,
    tags, metadata, version, status, createdAt
  }
```

Large files: chunked / multipart upload supported —
`POST /files/multipart/init` → `PUT /files/multipart/:uploadId/part/:n` → `POST /complete`.

---

## 5. Show / hide folders & files — manually AND via API

- Every folder and file has an `isHidden` boolean.
- **Manual** (UI): toggle button in the file list / folder list.
- **API**:
  - `POST /api/v1/folders/:id/hide`   /   `POST /api/v1/folders/:id/unhide`
  - `POST /api/v1/files/:id/hide`     /   `POST /api/v1/files/:id/unhide`
- Hidden items are not returned in default lists. Pass `?showHidden=true` to see them.
- Hiding is **not** deletion — the file stays in storage; it's just hidden from lists.

---

## 6. Three link types — public / private (JWT) / temporary

A single `links` collection covers all three.

| Type | Who can access | Auth at download | Expiry |
|------|----------------|------------------|--------|
| **public** | anyone with URL | none | optional (null = unlimited) |
| **private** | only valid JWT, right vendor + scope | `Authorization: Bearer <jwt>` | optional |
| **temporary** | anyone | none | required (1 minute → unlimited) |

### Create
```bash
POST /api/v1/files/:id/links     (auth required: session OR api key)
{
  "type": "temporary",      # public | private | temporary
  "expiresIn": 60,          # seconds. min 60 (1 minute)
  "neverExpire": false,     # true = unlimited
  "maxDownloads": 100,      # optional
  "requiredScope": "file:download",   # for private
  "password": "optional"
}
→ { id, type, accessUrl, expiresAt, ... }
```

### Download
- `GET /p/:token` — public
- `GET /t/:token` — temporary (just expiry/limit check)
- `GET /d/:token` — private (must send `Authorization: Bearer <jwt>` with right vendorId + scope)

### Reset ALL links for a file
```bash
POST /api/v1/files/:id/links/reset
{ "types": ["public","private","temporary"] }   # optional; empty = all
→ { revoked: N, regenerated: [...] }
```
All previously-shared URLs for that file become useless immediately. Optional
`regenerate: true` returns fresh tokens for each revoked link.

### Public-link rules (verified)
1. Look up by token.
2. Check `status === active`, `expiresAt` not past, `downloadCount < maxDownloads`.
3. **If vendor is suspended → 403** (point 7).
4. If password set, verify it.
5. If private, verify JWT → match `vendorId` → required scope.
6. Redirect to a short-lived presigned storage URL + `downloadCount++`.

Implementation: [`lib/link-handler.ts`](lib/link-handler.ts).

---

## 7. Vendor suspension — uploads + downloads + public links all blocked

When a SaaS admin suspends a vendor:

1. `vendors.status = "suspended"` is set.
2. Every protected route checks the vendor's status. If `suspended`:
   - **Upload** → `403 VENDOR_SUSPENDED`
   - **Download** (direct + all 3 link types) → `403 VENDOR_SUSPENDED`
   - Creating new links → blocked.
3. Vendor panel shows a red banner so the user knows their account is suspended.
4. **On activation, all data returns exactly as it was** — nothing is deleted.

UI: Admin → Vendors → click vendor → "Suspend" button.
API: `POST /api/v1/admin/vendors/:id/suspend` ↔ `POST /api/v1/admin/vendors/:id/activate`.

Suspension is enforced both inside route handlers (via the RBAC `can()` guard)
and inside the public link handler — so even an old shared URL stops working.

---

## 8. Maintenance mode — only SaaS Admin can log in

A flag in the `platform_settings` collection. When enabled:

- Vendor logins, public/private/temporary link downloads, and all vendor-scope API calls
  return `503 MAINTENANCE` with your custom message.
- **Only platform admin accounts can sign in and use the admin panel.**

UI: Admin → Maintenance → toggle. API: `POST /api/v1/admin/maintenance`.
Used during deploys and especially during server migration.

---

## 9. 3rd-party JWT issuance with RBAC scopes

A vendor can issue scoped JWTs to partner systems:

```bash
POST /api/v1/jwt/issue
{
  "subject": "partner-crm",
  "scopes": ["file:read", "file:download"],
  "bucketIds": ["..."],
  "expiresIn": 3600
}
→ { token, jti, expiresAt }
```

Use the token in `Authorization: Bearer <jwt>` to access **private** links (`/d/:token`)
or any other vendor API. Verified rules:

- signature (HS256)
- expiry (`exp`)
- tenant match — token's `vendorId` must equal the resource's vendor
- scope check — token's `scopes[]` must contain the required permission
- suspension — suspended vendor's tokens can't upload/download
- revocation — `jwt_revocations` collection by `jti` immediately invalidates a token

Code: [`lib/jwt.ts`](lib/jwt.ts), [`app/api/v1/jwt/issue/route.ts`](app/api/v1/jwt/issue/route.ts),
[`app/api/v1/jwt/revoke/route.ts`](app/api/v1/jwt/revoke/route.ts).

---

## 10. GitHub auto-deploy webhook (you asked for this)

Two options — pick either.

### Option A — Push-based webhook (already built in)
GitHub → Settings → Webhooks → Add webhook
- Payload URL: `https://files.yourdomain.com/api/v1/deploy/github`
- Secret: `GITHUB_WEBHOOK_SECRET` (same as in `.env`)
- Events: **push**

On push to `DEPLOY_BRANCH` (default `main`), the server:
1. Verifies the HMAC-SHA256 signature (`x-hub-signature-256`) using timing-safe compare.
2. Runs `scripts/deploy.sh` in the background:
   ```
   git fetch && git reset --hard origin/main
   npm ci
   npm test                  # CI gate
   npm run build
   pm2 reload filemanager    # zero-downtime
   ```
3. Returns `202 deploy started` immediately (GitHub has a 10s timeout).

Code: [`app/api/v1/deploy/github/route.ts`](app/api/v1/deploy/github/route.ts) +
[`scripts/deploy.sh`](scripts/deploy.sh).

### Option B — GitHub Actions SSH
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs tests on every push,
and on `main` SSHes into the VPS and runs the same git-pull / npm ci / build / pm2 reload.
Secrets needed: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

| | Option A (webhook) | Option B (Actions) |
|--|-------------------|--------------------|
| Build runs on | VPS | GitHub runner (faster, no VPS load) |
| Secret | webhook secret | SSH deploy key |
| Logs | tail `/var/log/deploy.log` | GitHub Actions UI |
| Recommended | small setups | teams / production |

---

## 11. Server migration (you asked for this)

`scripts/migrate.sh NEW_VPS_HOST` does the whole migration in one command:

1. **Maintenance mode ON** (so data stays consistent).
2. `mongodump` of the old DB → scp to new host → `mongorestore --drop` on new host.
3. **MinIO mirror** — `mc mirror --overwrite` source → destination bucket.
4. scp `.env` and the nginx config to the new host.
5. On the new host: `npm ci && npm run build && pm2 startOrReload && pm2 save`.
6. You: switch the DNS A record → wait → **Maintenance OFF**.

Things that survive migration unchanged because the DB moves with them:
- Public/temporary/private link tokens (still work)
- API key hashes (clients keep using the same plain key)
- Vendor usage counters (a recount script is included if you want to reconcile)

---

## 12. Install from a blank Ubuntu VPS — pull from GitHub

```bash
# On the fresh VPS:
bash <(curl -s https://raw.githubusercontent.com/yourorg/file-manager/main/scripts/install.sh) \
     https://github.com/yourorg/file-manager.git
```

Or step-by-step:
```bash
# 1) Clone
git clone https://github.com/yourorg/file-manager.git /var/www/app
cd /var/www/app
# 2) Configure
cp .env.example .env       # fill in JWT_SECRET, MONGODB_URI, S3_*
# 3) One-shot installer
bash scripts/install.sh https://github.com/yourorg/file-manager.git
```

The installer handles **Node 20 + Nginx + UFW + Docker + MinIO/Mongo (docker compose) +
PM2 + Certbot + seed first super_admin**. After it finishes, set up the Nginx vhost
([nginx/filemanager.conf](nginx/filemanager.conf)) and `sudo certbot --nginx -d files.yourdomain.com`.

### Private repo (deploy key — recommended)
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "vps"
cat ~/.ssh/deploy_key.pub      # → GitHub → Settings → Deploy keys (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/deploy_key\n' >> ~/.ssh/config
bash scripts/install.sh git@github.com:yourorg/file-manager.git
```

### Updating an existing install
```bash
cd /var/www/app
git pull origin main
npm ci && npm run build
pm2 reload filemanager
```
…or just push to `main` — the GitHub webhook (point 10) does this automatically.

---

## 13. Extras already in the build (not in your original list, but you'll want them)

| | What it does | Where |
|--|--------------|-------|
| **Storage quota** | Blocks upload when vendor exceeds `maxStorageBytes` → `413 QUOTA_EXCEEDED` | [`lib/quota.ts`](lib/quota.ts) |
| **File deduplication** | `checksum.sha256` indexed; reuse same object for duplicates | model + index |
| **Soft-delete + Trash** | `status="trashed"` + `deletedAt`; daily cron purges after 30 days | [`app/api/internal/cron/purge-trash`](app/api/internal/cron/purge-trash/route.ts) |
| **File versioning** | New upload with same name = `version++`, old versions kept | upload route |
| **Audit log** | Every state change goes to `audit_logs` (admin can browse) | [`lib/audit.ts`](lib/audit.ts) |
| **Rate limit** | Per-key / per-IP, in-memory token bucket | [`lib/ratelimit.ts`](lib/ratelimit.ts) |
| **App-level webhooks** | Per-vendor HMAC-signed POSTs on `file.uploaded`, `link.created`, etc. | [`lib/webhook.ts`](lib/webhook.ts) |
| **Search** | MongoDB text index on `originalName + tags` | model |
| **Health endpoint** | `/api/health` — DB + storage check (use UptimeRobot) | [`app/api/health`](app/api/health/route.ts) |
| **Mail** | SMTP/Resend/SES, transactional templates (welcome, suspended, quota warning) | [`lib/mail.ts`](lib/mail.ts) |
| **PWA** | Installable, offline fallback, mobile-first responsive UI | `public/manifest.webmanifest` + `public/sw.js` |
| **Reboot-safe** | PM2 startup + `pm2 save` + docker `restart: always` + `scripts/reboot-safe.sh` | `ecosystem.config.js` |
| **Cron jobs** | expire-urls (5 min), purge-trash (daily), backup (daily) | `app/api/internal/cron/*` + cron table example |
| **Backup** | `scripts/backup.sh` — daily mongodump + mc mirror + 14-day prune | scripts/ |
| **Tested core** | 27 verified security tests pass — `npm test` | [`tests/core-logic.test.js`](tests/core-logic.test.js) |

---

## 14. Cron table (paste into `crontab -e`)

```
# expire links every 5 min
*/5 * * * * curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:3000/api/internal/cron/expire-urls
# purge trash daily at 03:00 UTC
0 3 * * *   curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:3000/api/internal/cron/purge-trash
# daily backup at 04:00 UTC
0 4 * * *   /var/www/app/scripts/backup.sh
```

`INTERNAL_CRON_SECRET` lives in `.env` and the cron endpoints reject calls without that header
so they cannot be hit from outside.

---

## 15. Security checklist (all enforced)

- [x] All queries scoped by `vendorId` — cross-tenant access impossible
- [x] Passwords `argon2id`; API keys stored as `sha256` hash only
- [x] Suspension enforced on upload + download + every link type
- [x] Public tokens unguessable (24 random bytes by default)
- [x] Object keys tenant-prefixed at the storage level
- [x] Rate limit + audit log on state-changing routes
- [x] MIME + size validated on every upload (per-bucket policy too)
- [x] HTTPS-only secure HTTP-only cookies; security headers via middleware
- [x] zod validation on every route handler
- [x] GitHub webhook signature verified with timing-safe compare

---

## 16. File layout in this repo

```
app/
  (admin)/admin/         dashboard, vendors, usage, audit, maintenance
  (vendor)/dashboard/    home, buckets, api-keys, jwt, trash
  api/
    health/              health check
    internal/cron/       expire-urls, purge-trash (header-secret protected)
    v1/
      auth/login         logout         me
      admin/vendors      [id] suspend activate     usage audit-logs maintenance
      buckets            [bid]          folders     files     files/multipart/*
      folders/[id]       hide   unhide
      files/[id]         download hide unhide restore  links links/reset
      links/[id]
      api-keys/[id]
      jwt/issue          jwt/revoke
      deploy/github
  p/[token]/   t/[token]/   d/[token]/    download routes (public/temp/private)
  login/                   /             offline/
lib/
  db.ts auth.ts rbac.ts storage.ts jwt.ts links.ts link-handler.ts
  mail.ts ratelimit.ts audit.ts crypto.ts github-signature.ts
  maintenance.ts quota.ts validation.ts session-server.ts http.ts env.ts webhook.ts
models/
  Vendor.ts User.ts Bucket.ts Folder.ts File.ts ApiKey.ts Link.ts
  AuditLog.ts Webhook.ts PlatformSettings.ts JwtRevocation.ts
scripts/
  install.sh deploy.sh migrate.sh backup.sh reboot-safe.sh seed-admin.js
public/
  manifest.webmanifest  sw.js  icons/
nginx/
  filemanager.conf
.github/workflows/
  deploy.yml
tests/
  core-logic.test.js
docker-compose.yml  ecosystem.config.js  middleware.ts
.env.example  README.md  FEATURES.md
```

---

## 17. Verified tests — what was actually run

`npm test` runs `tests/core-logic.test.js` with `node --test`. Result:

```
[1] Public token
  ✔ token length >= 32 chars
  ✔ two tokens are unique
[2] Link validity (3 types)
  ✔ public active link usable
  ✔ temporary link 1-min not yet expired
  ✔ temporary link expired -> EXPIRED
  ✔ unlimited link (expiresAt null) never expires
  ✔ revoked link -> REVOKED
  ✔ maxDownloads reached -> LIMIT_REACHED
[3] 3rd-party JWT with RBAC scopes
  ✔ valid JWT verifies
  ✔ payload carries vendorId
  ✔ scope present -> true
  ✔ scope absent -> false
  ✔ tampered JWT rejected
  ✔ wrong secret rejected
  ✔ expired JWT -> EXPIRED
[4] Private link access (JWT-Token-Auth)
  ✔ valid token + scope -> access
  ✔ no token -> denied
  ✔ token from other vendor -> WRONG_TENANT
  ✔ token missing download scope -> MISSING_SCOPE
[5] GitHub deploy webhook signature
  ✔ correct signature accepted
  ✔ wrong signature rejected
  ✔ wrong secret rejected
[6] Suspension + tenant + RBAC guard
  ✔ active vendor can upload
  ✔ suspended vendor upload -> VENDOR_SUSPENDED
  ✔ suspended vendor download -> VENDOR_SUSPENDED
  ✔ cross-tenant access -> CROSS_TENANT
  ✔ missing permission -> FORBIDDEN

  27 passed, 0 failed
```

These are the security-critical algorithms — link validity, the 3-type system,
private-link JWT auth, 3rd-party JWT + RBAC, GitHub webhook signature, suspension rule
— **verified before any UI was wired**, so the building blocks are known-good.

---

## 18. .env keys (full list)

```
APP_URL, PORT
JWT_SECRET, SESSION_COOKIE_SECRET, SESSION_COOKIE_NAME, SESSION_TTL_HOURS
MONGODB_URI
STORAGE_DRIVER, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY,
S3_FORCE_PATH_STYLE, S3_USE_SSL, S3_DEFAULT_BUCKET
PUBLIC_URL_BASE, PUBLIC_TOKEN_BYTES
GITHUB_WEBHOOK_SECRET, DEPLOY_BRANCH, DEPLOY_SCRIPT
MAX_UPLOAD_BYTES
REDIS_URL, CLAMAV_HOST, CLAMAV_PORT
MAIL_DRIVER, MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
INTERNAL_CRON_SECRET, RATE_LIMIT_PER_MIN
```

Generate a secret: `openssl rand -hex 32`.

---

## 18b. Upgrades added in this round

Building on your 14-point checklist, these extras were added to make the
GitHub → blank Ubuntu VPS pull + update loop frictionless and the system more complete:

| Upgrade | Why | Where |
|---------|-----|-------|
| **One-command update from GitHub** | `bash scripts/update.sh` does `git pull → npm ci → npm test → npm run build → pm2 reload` in one shot. Idempotent — bails if HEAD already matches origin (unless `FORCE=1`). | [`scripts/update.sh`](scripts/update.sh) |
| **Automated cron setup** | `bash scripts/setup-cron.sh` writes the 5 cron jobs (expire-links / purge-trash / recount-usage / orphan-sweep / daily backup) into your crontab. Idempotent — re-running replaces the block instead of duplicating. | [`scripts/setup-cron.sh`](scripts/setup-cron.sh) |
| **Local healthcheck** | `bash scripts/healthcheck.sh` returns 0 if `/api/health` is green — drop into monitoring / readiness probes. | [`scripts/healthcheck.sh`](scripts/healthcheck.sh) |
| **Health endpoint upgraded** | Now returns `version`, `gitSha`, `uptimeSec`, per-check `latencyMs`. Useful for verifying a deploy actually picked up. | [`app/api/health/route.ts`](app/api/health/route.ts) |
| **Image processing on upload** | Sharp extracts width/height for images and generates `sm` (160 px) + `md` (480 px) WebP thumbnails, stored alongside the file. | [`lib/image.ts`](lib/image.ts), upload route |
| **File deduplication** | When the same `sha256` is uploaded again by the same vendor, the existing storage object is reused — no second copy, but each file row still tracks its own folder/tags/metadata/version. | upload route |
| **Quota warning email at 80%** | When a vendor crosses 80 % of `maxStorageBytes` on upload, an automatic email is fired (only on the crossing). | upload route + [`lib/mail.ts`](lib/mail.ts) |
| **Usage recount cron** | Weekly job that reconciles `vendor.usage` with actual `sum(sizeBytes)` and `count(*)` of files — fixes drift. | [`app/api/internal/cron/recount-usage`](app/api/internal/cron/recount-usage/route.ts) |
| **Orphan sweep cron** | Marks abandoned `uploading` rows older than 24 h as `failed`. | [`app/api/internal/cron/orphan-sweep`](app/api/internal/cron/orphan-sweep/route.ts) |
| **Postman collection** | One-click import for vendors. Variables for `baseUrl`, `apiKey`, `bucketId`, `fileId`, `vendorId`, `jwt`. | [`examples/postman-collection.json`](examples/postman-collection.json) |
| **Rate-limit headers helper** | `applyRateLimitHeaders(res, result)` adds standard `X-RateLimit-{Limit,Remaining,Reset}` headers. | [`lib/ratelimit.ts`](lib/ratelimit.ts) |

### What that means for your stated workflow

> "I will pull the project from GitHub on a blank Ubuntu VPS and update it."

```bash
# First install
ssh you@vps
git clone <REPO_URL> /var/www/app && cd /var/www/app
cp .env.example .env       # fill in values
bash scripts/install.sh <REPO_URL>
bash scripts/setup-cron.sh
sudo cp nginx/filemanager.conf /etc/nginx/sites-available/filemanager
sudo ln -s /etc/nginx/sites-available/filemanager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d files.yourdomain.com

# Every subsequent update — one command
bash scripts/update.sh

# Or just push to main and the GitHub webhook does it automatically
git push origin main
```

---

## 19. What to read next

1. Source of truth for the spec → [`file-manager-saas-complete-EN.md`](./file-manager-saas-complete-EN.md)
2. Code entry points →
   - Login: [`app/login/page.tsx`](app/login/page.tsx)
   - Admin: [`app/(admin)/admin/layout.tsx`](app/(admin)/admin/layout.tsx)
   - Vendor: [`app/(vendor)/dashboard/layout.tsx`](app/(vendor)/dashboard/layout.tsx)
   - Upload: [`app/api/v1/buckets/[bid]/files/route.ts`](app/api/v1/buckets/[bid]/files/route.ts)
   - Link create: [`app/api/v1/files/[id]/links/route.ts`](app/api/v1/files/[id]/links/route.ts)
   - Link download: [`lib/link-handler.ts`](lib/link-handler.ts)
   - RBAC guard: [`lib/rbac.ts`](lib/rbac.ts)
3. Ops → [`scripts/install.sh`](scripts/install.sh), [`scripts/deploy.sh`](scripts/deploy.sh), [`scripts/migrate.sh`](scripts/migrate.sh)

---

*Built end-to-end: Next.js (App Router, Server API) + MongoDB + MinIO. Everything in
your original brief, plus the GitHub auto-deploy webhook and one-command server migration.*
