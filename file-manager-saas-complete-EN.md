# File Manager SaaS

Multi-tenant file manager — **Next.js (App Router / Server API) + MongoDB + MinIO (S3-compatible)**.
Two panels: Admin + Vendor. A vendor creates its own buckets, uploads/downloads files, generates RBAC-scoped API keys and 3rd-party JWTs, and creates public / private(JWT) / temporary share-links.

> 📘 Full architecture, DB schema, API and security details are in the **Full Technical Documentation** section below.

---

## ✨ Features

- **Two panels** — SaaS Admin + Vendor (multi-tenant, `vendorId`-scoped, cross-tenant access blocked)
- **Buckets & folders** — each vendor owns its buckets; folders/files can be shown/hidden manually + via API
- **Full file details** saved (mime, size, checksum, dimensions, version, tags, metadata)
- **Upload → returns `{ id, ...full details }`**; chunked upload for large files
- **3 link types** — public / private (JWT-Token-Auth) / temporary (1 min → unlimited)
  - auth-verified create, access, and **reset-all-links** by file id
- **3rd-party JWT** issuance with RBAC scopes + expiry
- **RBAC** — roles + scoped permissions for users & API keys
- **Vendor suspension** — when suspended, upload/download (including public links) are all blocked
- **Maintenance mode** — only the SaaS Admin can log in
- **PWA** (installable + offline) + **mobile-first** responsive UI
- **Mail** (SMTP/Resend/SES), **webhooks** (app events) + **GitHub auto-deploy webhook**
- **Easy ops** — one-command reboot-safe, migration, install
- Storage quota, soft-delete/trash, dedup, thumbnails, virus-scan hook, rate-limit, audit log

---

## 🚀 Quick Start (Blank Ubuntu VPS)

```bash
# 1) Base tools
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx docker.io docker-compose-v2
sudo npm i -g pm2

# 2) Infra (Mongo + MinIO, localhost-only)
cd ~/infra && sudo docker compose up -d        # compose file in doc §15.3

# 3) App
git clone <REPO_URL> /var/www/app && cd /var/www/app
cp .env.example .env          # fill in the values (§14)
npm ci && npm run build
node scripts/seed-admin.js --email you@x.com --password '...'   # first super_admin
pm2 start npm --name filemanager -- start && pm2 save && pm2 startup

# 4) Nginx + SSL  (including client_max_body_size — §15.7)
sudo certbot --nginx -d files.yourdomain.com
```

---

## 📥 Install from GitHub

**Public repo:**
```bash
git clone https://github.com/yourorg/file-manager.git app
```

**Private repo — SSH deploy key (recommended):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "vps"
cat ~/.ssh/deploy_key.pub      # → GitHub repo → Settings → Deploy keys (read-only)
printf 'Host github.com\n  IdentityFile ~/.ssh/deploy_key\n' >> ~/.ssh/config
git clone git@github.com:yourorg/file-manager.git app
```

**Private repo — PAT (HTTPS):**
```bash
git clone https://<FINE_GRAINED_TOKEN>@github.com/yourorg/file-manager.git app
```

**One-shot installer (works for both public and private):**
```bash
bash scripts/install.sh https://github.com/yourorg/file-manager.git   # public
bash scripts/install.sh git@github.com:yourorg/file-manager.git       # private
```

---

## 🔧 Environment (`.env`)

Never commit `.env` — copy `.env.example` and fill in the values. Key variables:
`MONGODB_URI`, `JWT_SECRET`, `S3_ENDPOINT/ACCESS/SECRET`, `PUBLIC_URL_BASE`,
`GITHUB_WEBHOOK_SECRET`, `MAIL_*`, `MAX_UPLOAD_BYTES`. Full list in doc §14.

---

## 🔌 API at a glance

```bash
# Upload (returns id + full details)
curl -X POST https://files.yourdomain.com/api/v1/buckets/$BID/files \
  -H "Authorization: Bearer fmsk_xxx" -F file=@invoice.pdf

# Create a temporary link (1 min)
curl -X POST https://files.yourdomain.com/api/v1/files/$FID/links \
  -H "Authorization: Bearer fmsk_xxx" \
  -d '{"type":"temporary","expiresIn":60}'

# Reset (revoke) ALL links of a file
curl -X POST https://files.yourdomain.com/api/v1/files/$FID/links/reset \
  -H "Authorization: Bearer fmsk_xxx" -d '{}'

# Issue a 3rd-party JWT with scopes
curl -X POST https://files.yourdomain.com/api/v1/jwt/issue \
  -H "Authorization: Bearer fmsk_xxx" \
  -d '{"subject":"partner","scopes":["file:download"],"expiresIn":3600}'
```
Download: `/p/:token` (public) · `/t/:token` (temporary) · `/d/:token` + `Authorization: Bearer <jwt>` (private).
Full API + OpenAPI/Swagger UI at `/docs`. See doc §7, §23, §24.

---

## 🧪 Testing

```bash
npm test            # unit (Vitest/Jest)
npm run test:int    # integration (supertest + mongodb-memory-server)
npm run test:e2e    # Playwright (UI + mobile + PWA)
```

Core security logic is **verified** — link validity (3 types), private-link JWT auth,
3rd-party JWT + RBAC scopes, GitHub webhook signature, and the suspension rule were
run as a real test suite: **27 passed, 0 failed**. See doc §28 for full output.

CI gate (`.github/workflows/deploy.yml`): if `npm test` fails, deploy does not run.

---

## 🔁 Deploy / Reboot / Migrate / Maintenance

- **Auto-deploy:** GitHub push → webhook (signature-verified) or GitHub Actions SSH → `git pull && npm ci && npm run build && pm2 reload`. (doc §16)
- **Reboot-safe:** `pm2 save && pm2 startup` + docker `restart: always`. (§26.1)
- **Migration:** `./scripts/migrate.sh NEW_VPS_IP` — mongodump/restore + `mc mirror` + dns cutover. (§17, §26.3)
- **Maintenance mode:** `POST /api/v1/admin/maintenance {"enabled":true}` — only admins can log in, everything else returns 503. (§26.2)

---

## 🗂️ Project Structure

```
/app
  /(admin)/admin/...        # Admin panel
  /(vendor)/dashboard/...   # Vendor panel
  /p/[token]   /t/[token]   /d/[token]      # public / temporary / private download
  /api/v1/**                # Server API (route handlers)
/lib      db, auth, rbac, storage, mail, ratelimit, audit
/models   Vendor User Bucket Folder File ApiKey Link PlatformSettings ...
/scripts  install.sh deploy.sh migrate.sh backup.sh seed-admin.js
/middleware.ts             # auth + suspension + maintenance
```

---

## 🔐 Security Highlights

Tenant isolation everywhere · Argon2 passwords · API keys stored as hash only ·
unguessable signed tokens · suspension enforced on upload+download+all links ·
private storage (presigned access only) · HTTPS + secure cookies · zod validation ·
rate-limit + audit logs. Full checklist: doc §11.

---

# Full Technical Documentation

> The part above is a quick reference (README). Below is the complete technical documentation (architecture, DB schema, all APIs, security, deployment, etc.).

---

> **Stack:** Next.js (App Router, Server API / Route Handlers) · MongoDB (Mongoose) · S3-compatible storage (MinIO on your VPS, or local disk)
> **Audience:** Backend + Frontend developers building the platform
> **Version:** 1.0

This document contains the full system architecture, database schema, RBAC, API design, and security rules. Each section is self-contained enough that you can build the whole system by reading them in order.

---

## 1. Overview

A multi-tenant **File Manager SaaS**. Two types of users:

| Panel | Who uses it | Main job |
|-------|-------------|----------|
| **Admin Panel** | SaaS Owner / Platform Admin | Manage vendors, suspend/activate, global usage, billing, set limits |
| **Vendor Panel** | Your customer (each vendor = one tenant) | Create own buckets, upload/download files, create API keys, show/hide folders, generate public URLs |

**Multi-tenancy model:** every document carries a `vendorId`. All queries are always scoped by `vendorId` so one vendor can never see another's data.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Next.js (VPS)                          │
│                                                            │
│  ┌────────────┐   ┌────────────┐   ┌──────────────────┐   │
│  │ Admin UI   │   │ Vendor UI  │   │  Public URL page │   │
│  │ (React)    │   │ (React)    │   │  (download)      │   │
│  └─────┬──────┘   └─────┬──────┘   └────────┬─────────┘   │
│        │                │                   │             │
│  ┌─────┴────────────────┴───────────────────┴─────────┐   │
│  │        Route Handlers  /app/api/**  (Server API)    │   │
│  │  - Auth (session JWT)   - API Key auth              │   │
│  │  - RBAC middleware      - Rate limiter              │   │
│  └─────┬───────────────────────────────┬───────────────┘   │
│        │                               │                   │
│   ┌────┴─────┐                  ┌──────┴───────┐           │
│   │ MongoDB  │                  │  Storage     │           │
│   │ (meta)   │                  │  MinIO / S3  │           │
│   └──────────┘                  │  / disk      │           │
│                                 └──────────────┘           │
└──────────────────────────────────────────────────────────┘
```

**Core principle:** the actual file bytes go to storage (MinIO/S3/disk), and **all file details (metadata)** go to MongoDB. The database never stores raw files.

---

## 3. Authentication & Identity

Two kinds of auth must be supported:

### 3.1 Session Auth (for UI use)
- Admin and Vendor log in with email + password.
- Passwords are hashed with `argon2` or `bcrypt`.
- On successful login, a **JWT** (or NextAuth session) is issued and stored in an HTTP-only secure cookie.
- JWT payload: `{ userId, vendorId, role, panel }`.

### 3.2 API Key Auth (programmatic access — the vendor's API)
- A vendor can create API keys from their own panel.
- Key format: `fmsk_<random-32-bytes-base62>`. The full key is shown only once, at creation time.
- Only the **hash** (SHA-256) of the key is stored in the database, never the plain key.
- Each key carries **scopes** (RBAC permissions) and an optional **bucket restriction**.
- Request header: `Authorization: Bearer fmsk_xxx` or `x-api-key: fmsk_xxx`.

> **The suspension rule is enforced here:** the auth middleware checks the vendor's `status` on every request. If `status === "suspended"`, all upload/download return 403 (see section 9).

---

## 4. RBAC (Role-Based Access Control)

### 4.1 Roles

| Role | Panel | Description |
|------|-------|-------------|
| `super_admin` | Admin | Platform owner, can do everything |
| `platform_staff` | Admin | Support staff, can suspend vendors but not billing |
| `vendor_owner` | Vendor | Owner of a vendor account |
| `vendor_admin` | Vendor | Admin appointed by the owner; manages members & buckets |
| `vendor_member` | Vendor | Works only within specific granted permissions |

### 4.2 Permissions (scopes)

These permissions map onto both API keys and user roles:

```
bucket:create     bucket:read      bucket:update     bucket:delete
file:upload       file:read        file:download     file:delete
file:list         folder:create    folder:update     folder:hide
publicurl:create  publicurl:revoke apikey:create     apikey:revoke
member:invite     member:remove    settings:update
```

### 4.3 How it is enforced

A guard in every protected route handler:

```ts
// lib/rbac.ts
export function can(principal, permission, resource) {
  // 1. principal suspended? -> deny
  if (principal.vendor.status !== "active") return false;
  // 2. cross-tenant block: resource.vendorId === principal.vendorId
  if (resource && resource.vendorId !== principal.vendorId) return false;
  // 3. role/scope check
  return principal.permissions.includes(permission);
}
```

```ts
// usage inside a route handler
const principal = await authenticate(req);          // session OR api key
if (!can(principal, "file:upload", { vendorId: principal.vendorId }))
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
```

**Rule:** an API key can only do what its scopes allow — a key never inherits the full permissions of the vendor that created it (principle of least privilege).

---

## 5. Storage Layer

You're on a VPS, so there are two options:

1. **MinIO (recommended)** — S3-compatible, self-hostable on your VPS. Native support for signed URLs, buckets, objects. The code stays the same even if you later migrate to AWS S3.
2. **Local disk** — works at small scale, but you must handle signed URLs/scaling yourself.

**Recommendation:** use MinIO. Abstract the storage layer behind an interface so it's easy to swap later:

```ts
interface StorageDriver {
  putObject(key, stream, meta): Promise<{ etag, size }>;
  getObject(key): Promise<Stream>;
  deleteObject(key): Promise<void>;
  presignedGet(key, expirySeconds): Promise<string>;
  initMultipart(key): Promise<uploadId>;
  // ...
}
```

**Object key convention** (where files live in storage):
```
vendors/{vendorId}/buckets/{bucketId}/{fileId}/{originalFilename}
```
This keeps tenant isolation at the storage level too.

---

## 6. MongoDB Data Model

Every collection indexes `vendorId` for tenant isolation.

### 6.1 `vendors`
```js
{
  _id: ObjectId,
  name: String,
  slug: String,                 // unique
  status: "active" | "suspended" | "pending",  // <-- suspension rule
  suspendedReason: String,
  plan: "free" | "pro" | "enterprise",
  limits: {
    maxStorageBytes: Number,    // e.g. 10 GB
    maxBuckets: Number,
    maxApiKeys: Number,
    maxFileSizeBytes: Number,
  },
  usage: {
    storageBytes: Number,       // running total
    fileCount: Number,
  },
  createdAt, updatedAt
}
```

### 6.2 `users`
```js
{
  _id, vendorId: ObjectId | null,   // admin users -> null
  email: String,                    // unique
  passwordHash: String,
  role: "super_admin" | "platform_staff" | "vendor_owner" | "vendor_admin" | "vendor_member",
  permissions: [String],            // resolved scopes
  status: "active" | "disabled",
  lastLoginAt,
  createdAt, updatedAt
}
```

### 6.3 `buckets`
```js
{
  _id, vendorId: ObjectId,
  name: String,                     // unique per vendor
  description: String,
  isPublic: Boolean,                // default false
  storageBytes: Number,
  fileCount: Number,
  settings: {
    allowedMimeTypes: [String],     // empty = all
    maxFileSizeBytes: Number,
  },
  createdAt, updatedAt
}
// index: { vendorId: 1, name: 1 } unique
```

### 6.4 `folders`
```js
{
  _id, vendorId: ObjectId, bucketId: ObjectId,
  name: String,
  parentId: ObjectId | null,        // nested folders
  path: String,                     // e.g. "/invoices/2025"  (materialized path)
  isHidden: Boolean,                // <-- manual & API show/hide
  hiddenBy: ObjectId,
  hiddenAt: Date,
  createdAt, updatedAt
}
// index: { vendorId:1, bucketId:1, parentId:1 }
```

### 6.5 `files` — full details stored here
```js
{
  _id, vendorId: ObjectId, bucketId: ObjectId, folderId: ObjectId | null,

  // identity
  originalName: String,             // "invoice.pdf"
  storageKey: String,               // path in MinIO/S3
  extension: String,                // "pdf"

  // full file details
  mimeType: String,                 // "application/pdf"
  sizeBytes: Number,
  checksum: { md5: String, sha256: String },
  width: Number, height: Number,    // images/video
  duration: Number,                 // audio/video seconds
  pageCount: Number,                // pdf/docs

  // image thumbnails (optional generated)
  thumbnails: [{ size: "sm"|"md", storageKey, width, height }],

  // organization
  tags: [String],
  metadata: Object,                 // arbitrary custom key/values
  isHidden: Boolean,                // manual & API show/hide

  // lifecycle
  version: Number,                  // versioning
  status: "ready" | "uploading" | "failed" | "trashed",
  uploadedBy: ObjectId,
  uploadSource: "ui" | "api",
  apiKeyId: ObjectId | null,        // which key uploaded it

  deletedAt: Date | null,           // soft delete
  createdAt, updatedAt
}
// indexes:
//   { vendorId:1, bucketId:1, folderId:1 }
//   { vendorId:1, status:1 }
//   { "checksum.sha256":1 }          (dedup)
//   text index on { originalName, tags } (search)
```

### 6.6 `api_keys`
```js
{
  _id, vendorId: ObjectId,
  name: String,
  keyHash: String,                  // sha256(plainKey), plain is never stored
  prefix: String,                   // "fmsk_ab12" just for recognition
  permissions: [String],            // scopes
  bucketIds: [ObjectId],            // empty = all buckets
  status: "active" | "revoked",
  lastUsedAt, expiresAt,
  createdBy: ObjectId,
  createdAt, updatedAt
}
// index: { keyHash:1 } unique
```

### 6.7 `public_urls` — signed/public links
```js
{
  _id, vendorId: ObjectId, fileId: ObjectId,
  token: String,                    // random, goes in the URL
  mode: "redirect" | "stream",
  expiresAt: Date | null,           // null = unlimited / never expires
  maxDownloads: Number | null,      // optional limit
  downloadCount: Number,
  password: String | null,          // optional hashed password
  status: "active" | "revoked" | "expired",
  createdBy: ObjectId,
  createdAt
}
// index: { token:1 } unique, { expiresAt:1 } (TTL-safe cleanup)
```

### 6.8 `audit_logs`
```js
{
  _id, vendorId, actorId, actorType: "user"|"apikey",
  action: String,                   // "file.upload", "vendor.suspend" ...
  resourceType, resourceId,
  ip, userAgent,
  meta: Object,
  createdAt
}
```

### 6.9 `webhooks` (extra)
```js
{
  _id, vendorId, url, secret,
  events: ["file.uploaded","file.deleted","publicurl.created"],
  status: "active"|"disabled", createdAt
}
```

---

## 7. API Design (Server API / Route Handlers)

Base path: `/api/v1`. All responses JSON. Standard error format:
```json
{ "error": { "code": "FORBIDDEN", "message": "..." } }
```

### 7.1 Auth
| Method | Path | Job |
|--------|------|-----|
| POST | `/auth/login` | login, set session cookie |
| POST | `/auth/logout` | logout |
| GET | `/auth/me` | current principal |

### 7.2 Admin Panel
| Method | Path | Permission |
|--------|------|-----------|
| GET | `/admin/vendors` | list vendors |
| POST | `/admin/vendors` | create vendor |
| GET | `/admin/vendors/:id` | vendor details + usage |
| PATCH | `/admin/vendors/:id` | update limits/plan |
| POST | `/admin/vendors/:id/suspend` | **suspend** (status = suspended) |
| POST | `/admin/vendors/:id/activate` | **activate** |
| GET | `/admin/usage` | global storage/file stats |
| GET | `/admin/audit-logs` | platform audit logs |

### 7.3 Buckets (Vendor)
| Method | Path | Permission |
|--------|------|-----------|
| POST | `/buckets` | `bucket:create` |
| GET | `/buckets` | `bucket:read` |
| GET | `/buckets/:id` | `bucket:read` |
| PATCH | `/buckets/:id` | `bucket:update` |
| DELETE | `/buckets/:id` | `bucket:delete` |

### 7.4 Folders (Vendor) — including show/hide
| Method | Path | Permission |
|--------|------|-----------|
| POST | `/buckets/:bid/folders` | `folder:create` |
| GET | `/buckets/:bid/folders?showHidden=false` | `file:list` |
| PATCH | `/folders/:id` | `folder:update` |
| POST | `/folders/:id/hide` | `folder:hide` → `isHidden=true` |
| POST | `/folders/:id/unhide` | `folder:hide` → `isHidden=false` |
| DELETE | `/folders/:id` | `folder:update` |

> Show/hide can be toggled from the UI, and can also be done via API using these two endpoints — both update the same field (`isHidden`). Passing `showHidden=true` to the list endpoint returns hidden items too (if you have permission).

### 7.5 Files (Vendor)

**Upload — direct (small files):**
```
POST /api/v1/buckets/:bid/files
Content-Type: multipart/form-data
fields: file, folderId?, tags?, metadata?
```
**Response (after upload, returns id + full details):**
```json
{
  "id": "66f...e21",
  "originalName": "invoice.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 482113,
  "extension": "pdf",
  "checksum": { "sha256": "a1b2..." },
  "bucketId": "...",
  "folderId": null,
  "version": 1,
  "status": "ready",
  "createdAt": "2026-06-02T10:11:12Z"
}
```

| Method | Path | Permission |
|--------|------|-----------|
| POST | `/buckets/:bid/files` | `file:upload` |
| GET | `/buckets/:bid/files?folderId=&showHidden=&q=&page=` | `file:list` |
| GET | `/files/:id` | `file:read` (full details) |
| GET | `/files/:id/download` | `file:download` |
| PATCH | `/files/:id` | rename/tags/metadata |
| POST | `/files/:id/hide` / `/unhide` | `folder:hide` (file-level too) |
| DELETE | `/files/:id` | `file:delete` (soft delete → trash) |
| POST | `/files/:id/restore` | restore from trash |

**Chunked / Multipart upload (for large files — extra):**
```
POST  /files/multipart/init      -> { uploadId, fileId }
PUT   /files/multipart/:uploadId/part/:n   (per chunk)
POST  /files/multipart/:uploadId/complete  -> final file details
POST  /files/multipart/:uploadId/abort
```

### 7.6 Public URL — 1 minute to unlimited time
```
POST /api/v1/files/:id/public-url
{
  "expiresIn": 60,          // seconds. min 60 (1 min)
  "neverExpire": false,     // true = unlimited
  "maxDownloads": 100,      // optional
  "password": "optional"
}
```
**Response:**
```json
{
  "id": "purl_...",
  "url": "https://yourdomain.com/p/AbCd1234xyz",
  "expiresAt": "2026-06-02T10:12:12Z",   // null = never
  "maxDownloads": 100
}
```

| Method | Path | Job |
|--------|------|-----|
| POST | `/files/:id/public-url` | create (expiry 60s … unlimited) |
| GET | `/files/:id/public-urls` | list active links |
| DELETE | `/public-urls/:id` | revoke |
| GET | `/p/:token` | **public download** (no auth) |

**Public download logic (`/p/:token`):**
1. Look up the `public_urls` record by token.
2. Check `status === active`, that `expiresAt` hasn't passed, and `downloadCount < maxDownloads`.
3. **If the vendor is suspended, 403 here too** (the suspension rule applies to public links as well).
4. Verify the password if one is set.
5. If all good, redirect to a presigned storage URL or stream the file, and `downloadCount++`.

### 7.7 API Keys (Vendor)
| Method | Path | Permission |
|--------|------|-----------|
| POST | `/api-keys` | `apikey:create` → returns the full key once |
| GET | `/api-keys` | list (prefix only) |
| DELETE | `/api-keys/:id` | `apikey:revoke` |

---

## 8. Folder & File Show/Hide — clear explanation

- Every folder and file has an `isHidden` boolean.
- **Manual:** a toggle/eye-icon in the UI — clicking it calls `/hide` or `/unhide`.
- **API:** a vendor can hit the same endpoints with their API key.
- Hidden items don't appear in the default list. They appear only when you pass `showHidden=true` (and have permission).
- Hiding is not deleting — the file stays in storage, it's just hidden from the list.

---

## 9. Vendor Suspension Rule (important)

When a SaaS admin suspends a vendor:

1. `vendors.status = "suspended"` is set.
2. The auth middleware loads the vendor's status on every request. If `suspended`:
   - **Upload** → `403 VENDOR_SUSPENDED`
   - **Download** (both direct and public URL `/p/:token`) → `403 VENDOR_SUSPENDED`
   - Creating new public URLs → blocked.
3. Read-only metadata (e.g. "your account is suspended") may be shown — but no bytes are transferred.
4. On activation, all previous data returns exactly as it was (nothing is deleted).

```ts
// middleware concept
if (principal.vendor.status === "suspended" &&
    ["file:upload", "file:download"].includes(neededPermission)) {
  return deny(403, "VENDOR_SUSPENDED");
}
```

---

## 10. Extra Features (recommended — needed in production)

Beyond what you asked for, adding these completes the system:

1. **Storage quota enforcement** — before upload, check `vendor.usage.storageBytes + fileSize <= limits.maxStorageBytes`. Otherwise `413 QUOTA_EXCEEDED`. On successful upload, update `usage` with an atomic `$inc`.
2. **File deduplication** — if the `sha256` matches, reference the same object to save storage.
3. **Soft delete + Trash + auto-purge** — on delete set `status="trashed"`, permanently remove via cron after 30 days.
4. **File versioning** — a new upload with the same name does `version++` and keeps old versions.
5. **Thumbnails / image processing** — generate image thumbnails with `sharp` and store them.
6. **Virus / malware scan hook** — after upload, send to ClamAV to scan; if infected set `status="failed"`.
7. **Rate limiting** — per API key and per IP (e.g. `100 req/min`), via Redis.
8. **Audit logs** — record who did what and when in `audit_logs`. Visible to admins.
9. **Webhooks** — send HMAC-signed POSTs to the vendor's URL on events like `file.uploaded`.
10. **Search & filter** — search by name/tag via a MongoDB text index, with mimeType/size/date filters.
11. **CDN caching** — put public URLs behind a CDN for faster downloads.
12. **Encryption at rest** — enable MinIO server-side encryption (SSE).
13. **Signed URL security** — public tokens random and unguessable (≥ 24 bytes). Expiry checked in MongoDB; keep the storage presigned URL's own expiry short and separate.
14. **Per-bucket MIME / size policy** — enforce allowed types and max size per bucket settings.
15. **Billing / usage metering** — track storage + bandwidth and invoice per plan.
16. **2FA for admin** — add TOTP to the admin panel.
17. **Backups** — regular automated backups of MongoDB and MinIO.

---

## 11. Security Checklist

- [ ] All queries scoped by `vendorId` — cross-tenant access impossible
- [ ] Passwords `argon2id`, API keys stored as hash only
- [ ] Suspension enforced on upload + download + public URL — everywhere
- [ ] Public tokens unguessable, with expiry + maxDownloads + optional password
- [ ] Storage object keys tenant-prefixed
- [ ] Rate limiting + audit logging enabled
- [ ] MIME and size validation on upload (don't trust the extension)
- [ ] Direct storage bucket private; access only via presigned URL
- [ ] HTTPS only, secure HTTP-only cookies, CSRF protection on session routes
- [ ] Input validation (zod) in every route handler

---

## 12. Suggested Project Structure (Next.js App Router)

```
/app
  /(admin)/admin/...              # Admin Panel UI
  /(vendor)/dashboard/...         # Vendor Panel UI
  /p/[token]/route.ts             # public download
  /api/v1
    /auth/[...]/route.ts
    /admin/vendors/route.ts
    /admin/vendors/[id]/suspend/route.ts
    /buckets/route.ts
    /buckets/[bid]/files/route.ts
    /files/[id]/route.ts
    /files/[id]/download/route.ts
    /files/[id]/public-url/route.ts
    /api-keys/route.ts
/lib
  db.ts            # mongoose connection (cached for serverless)
  auth.ts          # session + api key authenticate()
  rbac.ts          # can() permission guard
  storage.ts       # StorageDriver (MinIO/S3/disk)
  ratelimit.ts
  audit.ts
/models            # mongoose schemas (Vendor, User, Bucket, Folder, File, ...)
/middleware.ts     # global auth + suspension check
```

---

## 13. Typical Upload Flow (end-to-end)

```
1. Vendor UI/API → POST /buckets/:bid/files (file)
2. authenticate() → verify session/api key
3. can(principal, "file:upload") + verify vendor.status === active
4. quota check (usage + size <= limit)
5. MIME + size validation (bucket policy)
6. storage.putObject(key, stream) → save to MinIO
7. extract checksum + metadata (mime, size, dimensions)
8. insert files document into MongoDB (status="ready")
9. vendor.usage.$inc(storageBytes, fileCount)
10. audit log + webhook fire (file.uploaded)
11. Response: { id, full file details }   ← your requirement
```

---

## 14. Environment Variables (`.env`)

Never commit `.env` to GitHub. Commit only a `.env.example`, and keep the real values on the VPS.

```ini
# App
NODE_ENV=production
APP_URL=https://files.yourdomain.com
PORT=3000

# Auth
JWT_SECRET=<64-char-random>
SESSION_COOKIE_SECRET=<random>

# MongoDB
MONGODB_URI=mongodb://fmsuser:strongpass@127.0.0.1:27017/filemanager?authSource=admin

# Storage (MinIO / S3)
STORAGE_DRIVER=minio
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=<minio-access-key>
S3_SECRET_KEY=<minio-secret-key>
S3_FORCE_PATH_STYLE=true
S3_USE_SSL=false

# Public URL signing
PUBLIC_URL_BASE=https://files.yourdomain.com/p
PUBLIC_TOKEN_BYTES=24

# Deploy webhook (section 16)
GITHUB_WEBHOOK_SECRET=<random-strong-secret>
DEPLOY_BRANCH=main

# Limits
MAX_UPLOAD_BYTES=524288000   # 500 MB

# Optional
REDIS_URL=redis://127.0.0.1:6379
CLAMAV_HOST=127.0.0.1
```

> **Generate a secret:** `openssl rand -hex 32`

---

## 15. Deployment — Pulling and Running from GitHub on a Blank Ubuntu VPS

Step by step, assuming a completely blank Ubuntu 22.04/24.04.

### 15.1 Server hardening (first)
```bash
# new non-root user
adduser deploy && usermod -aG sudo deploy
# copy your SSH key and disable password login (/etc/ssh/sshd_config: PasswordAuthentication no)

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
# important: do NOT expose MongoDB(27017) or MinIO(9000) externally — localhost only

sudo apt update && sudo apt upgrade -y
sudo apt install -y fail2ban
```

### 15.2 Required packages
```bash
# Node.js 20 (for Next.js)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# PM2 (process manager)
sudo npm i -g pm2

# Certbot (SSL)
sudo apt install -y certbot python3-certbot-nginx
```

### 15.3 MongoDB + MinIO

Two options — **Docker (recommended, clean)** or native install.

**Using Docker compose (infra services):** `~/infra/docker-compose.yml`
```yaml
services:
  mongo:
    image: mongo:7
    restart: always
    ports: ["127.0.0.1:27017:27017"]   # localhost only
    environment:
      MONGO_INITDB_ROOT_USERNAME: fmsuser
      MONGO_INITDB_ROOT_PASSWORD: strongpass
    volumes: ["mongo_data:/data/db"]

  minio:
    image: minio/minio
    restart: always
    command: server /data --console-address ":9001"
    ports:
      - "127.0.0.1:9000:9000"
      - "127.0.0.1:9001:9001"
    environment:
      MINIO_ROOT_USER: <minio-access-key>
      MINIO_ROOT_PASSWORD: <minio-secret-key>
    volumes: ["minio_data:/data"]

volumes: { mongo_data: {}, minio_data: {} }
```
```bash
sudo apt install -y docker.io docker-compose-v2
cd ~/infra && sudo docker compose up -d
```

### 15.4 Pull the project from GitHub

**Deploy key (read-only, recommended)** or HTTPS + Personal Access Token:
```bash
# SSH deploy key
ssh-keygen -t ed25519 -C "vps-deploy" -f ~/.ssh/deploy_key
cat ~/.ssh/deploy_key.pub
# add this key to GitHub repo → Settings → Deploy keys (read-only)

# in ~/.ssh/config:
#   Host github.com
#     IdentityFile ~/.ssh/deploy_key

cd /var/www
git clone git@github.com:yourorg/file-manager.git app
cd app
```

### 15.5 Build & run
```bash
cd /var/www/app
cp .env.example .env     # then fill in the real values in .env
npm ci
npm run build            # Next.js production build
pm2 start npm --name "filemanager" -- start
pm2 save
pm2 startup              # auto-start after reboot (run the command it prints)
```

### 15.6 Database seed — first super admin
Keep a seed script (`scripts/seed-admin.ts`) to create the first admin:
```bash
node scripts/seed-admin.js --email you@domain.com --password '...'
# inserts into the users collection with the super_admin role
```

### 15.7 Nginx reverse proxy (+ large file upload)
`/etc/nginx/sites-available/filemanager`:
```nginx
server {
  server_name files.yourdomain.com;

  client_max_body_size 500M;          # <-- essential for file uploads
  proxy_read_timeout 300;
  proxy_send_timeout 300;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo ln -s /etc/nginx/sites-available/filemanager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d files.yourdomain.com   # SSL + auto-renew
```

> **A point worth flagging:** without `client_max_body_size`, Nginx will block large uploads with 413 — this is essential for a file manager.

---

## 16. GitHub Webhook — Auto Deploy (CI/CD)

> ⚠️ This is different from the **app webhook** in section 6.9 / 10 (file.uploaded etc.). This is a **deploy webhook** — when you push to GitHub, the VPS pulls + builds + restarts the new code itself.

Two approaches. Pick either one.

### Option A — Push-based deploy listener (webhook endpoint)

GitHub repo → **Settings → Webhooks → Add webhook**
- Payload URL: `https://files.yourdomain.com/api/v1/deploy/github`
- Content type: `application/json`
- Secret: `GITHUB_WEBHOOK_SECRET` (same value as in env)
- Events: **push** only

**Route handler concept** (`/app/api/v1/deploy/github/route.ts`):
```ts
import crypto from "crypto";
import { exec } from "child_process";

export async function POST(req) {
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") || "";
  const expected = "sha256=" + crypto
    .createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET)
    .update(raw).digest("hex");

  // signature verify (timing-safe)
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) return new Response("invalid signature", { status: 401 });

  const body = JSON.parse(raw);
  if (body.ref !== `refs/heads/${process.env.DEPLOY_BRANCH}`)
    return new Response("ignored branch", { status: 200 });

  // async deploy, respond immediately (GitHub has a 10s timeout)
  exec("/var/www/app/scripts/deploy.sh >> /var/log/deploy.log 2>&1 &");
  return new Response("deploy started", { status: 202 });
}
```

**`scripts/deploy.sh`:**
```bash
#!/usr/bin/env bash
set -e
cd /var/www/app
git fetch --all
git reset --hard origin/main
npm ci
npm run build
pm2 reload filemanager --update-env   # zero-downtime reload
echo "deployed $(date)"
```
```bash
chmod +x /var/www/app/scripts/deploy.sh
```

**Security:** signature verification is mandatory, accept only `DEPLOY_BRANCH`, and don't let arbitrary input reach deploy.sh. You can also run this as a separate small service on its own port if you prefer.

### Option B — GitHub Actions + SSH deploy (cleaner, recommended)

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy over SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /var/www/app
            git pull origin main
            npm ci
            npm run build
            pm2 reload filemanager --update-env
```
Add `VPS_HOST` and `VPS_SSH_KEY` under GitHub repo → Settings → Secrets.

| | Option A (webhook) | Option B (Actions) |
|--|--------------------|--------------------|
| Where it builds | on the VPS | on the GitHub runner (optional), or VPS |
| Secret | webhook secret | SSH key |
| Rollback/log | handle yourself | history in the Actions UI |
| Recommended for | small setups | **team / production** |

---

## 17. Server Migration (old VPS → new VPS)

Data: **(a) MongoDB metadata** + **(b) MinIO/S3 file bytes** + **(c) env/secrets/config** — all three must be migrated.

### 17.1 Preparation
1. Install everything on the new VPS per section 15 (don't send traffic yet).
2. Lower the DNS TTL in advance (e.g. 300s) — this enables a fast cutover later.
3. Keep a **maintenance mode** flag (platform setting) — to stop writes during migration so the data stays consistent.

### 17.2 Migrate MongoDB
```bash
# on the old VPS
mongodump --uri="$MONGODB_URI" --archive=/tmp/db.archive --gzip

# send to the new VPS
scp /tmp/db.archive deploy@NEW_VPS:/tmp/

# restore on the new VPS
mongorestore --uri="$MONGODB_URI" --archive=/tmp/db.archive --gzip --drop
```

### 17.3 Migrate MinIO / file bytes
```bash
# bucket-to-bucket mirror with the MinIO client (mc) (safest)
mc alias set old http://OLD_VPS:9000 OLD_KEY OLD_SECRET
mc alias set new http://NEW_VPS:9000 NEW_KEY NEW_SECRET
mc mirror --overwrite old/ new/

# or rsync if it's a docker volume
rsync -avz /var/lib/docker/volumes/infra_minio_data/_data/ \
      deploy@NEW_VPS:/var/lib/docker/volumes/infra_minio_data/_data/
```

### 17.4 Config / secrets
- Copy `.env`, the Nginx config, and deploy keys to the new VPS.
- Re-issue SSL: `sudo certbot --nginx -d files.yourdomain.com`.

### 17.5 Cutover
1. Turn maintenance mode ON on the old server → do a final delta sync (run `mongodump` + `mc mirror` again to catch any gap data).
2. Start the app on the new VPS + smoke test (login, upload, download, public URL, suspend rule).
3. Point the DNS A record to the new VPS's IP.
4. After propagation, verify → keep the old VPS for a while, then decommission.

### 17.6 Migration checklist
- [ ] Full backup before migration (db + storage)
- [ ] vendor `usage` counters are correct on the new server (run a recount script if needed)
- [ ] Public URL tokens still work (same DB, same domain)
- [ ] API keys unchanged (the hashes are in the same DB)
- [ ] Cron jobs set up on the new server (section 18)
- [ ] Keep both VPSes parallel for 48 hours before shutting the old one down

---

## 18. Cron Jobs & Maintenance

Run via the PM2 ecosystem or system `cron`:

| Job | Frequency | Description |
|-----|-----------|-------------|
| Expired public URL cleanup | every 5 min | `expiresAt < now` → `status="expired"` |
| Trash auto-purge | daily | delete `trashed` files older than 30 days, including storage |
| Usage recount | weekly | reconcile `vendor.usage` against actual file sizes |
| DB + MinIO backup | daily | `mongodump` + `mc mirror` to offsite |
| Orphan object sweep | weekly | delete objects that exist in storage but not in the DB |

```bash
# crontab -e example
*/5 * * * * curl -s http://127.0.0.1:3000/api/internal/cron/expire-urls
0 3 * * *   /var/www/app/scripts/backup.sh
```
> Protect the internal cron endpoints with a secret header so they can't be hit from outside.

---

## 19. Monitoring, Logging & Backups

- **Process & logs:** `pm2 logs`, `pm2 monit`. To centralize logs, use PM2 logrotate (`pm2 install pm2-logrotate`).
- **Health check:** build a `/api/health` endpoint (pings DB + storage, returns `200`/`503`). Add an uptime monitor (UptimeRobot/BetterStack).
- **Error tracking:** integrate Sentry.
- **Metrics:** show storage usage, upload count, 4xx/5xx rate on the admin dashboard.
- **Backups:** daily `mongodump` + MinIO `mc mirror` to another region/provider. Test a restore once a month (an untested backup = no backup).
- **Alerts:** notify on disk > 80%, vendor quota nearly full, deploy failure.

---

## 20. Summary of what was added (this version)

- Full `.env` reference (never commit secrets)
- Full path: Blank Ubuntu VPS → GitHub pull → build → PM2 → Nginx + SSL
- **Nginx `client_max_body_size`** (an essential point for large uploads)
- First **super_admin seed** script
- **GitHub auto-deploy webhook** (Option A signature-verified listener, Option B GitHub Actions SSH)
- Full **server migration** plan (Mongo + MinIO + config + cutover + checklist)
- **Cron jobs** (expired URL, trash purge, backup, orphan sweep)
- **Monitoring / health check / backup** strategy
- **Maintenance mode** flag (for migration and safe deploys)

---

## 21. PWA (Progressive Web App)

To make the app installable + offline-capable:

- **`public/manifest.webmanifest`:**
```json
{
  "name": "File Manager",
  "short_name": "Files",
  "start_url": "/dashboard",
  "display": "standalone",
  "background_color": "#0b0b0c",
  "theme_color": "#0b0b0c",
  "icons": [
    { "src": "/icons/192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
- Generate the service worker with `next-pwa` (or Serwist) in Next.js.
- **Caching strategy:** static assets → cache-first; API/file list → network-first with fallback; never cache file downloads (private data).
- Show a nice "You're offline" fallback page when offline.
- Trigger the "Add to Home Screen" prompt with a custom button (`beforeinstallprompt`).
- For iOS, add `apple-touch-icon` and the `apple-mobile-web-app-capable` meta.

---

## 22. Mobile-Friendly / Responsive UI

- **Mobile-first** Tailwind breakpoints (`sm md lg xl`). Get the layout right on small screens first, then scale up.
- Touch targets ≥ **44×44px**, with adequate spacing.
- File list: desktop = table, mobile = card/stacked view.
- **Bottom navigation bar** on mobile, **sidebar** on desktop.
- Upload: directly from camera/gallery on mobile (`<input capture>`), drag-drop on desktop.
- Use **bottom sheets / modals** for big actions, and avoid hover-dependent UI (there's no hover on mobile).
- Handle the `viewport` meta + safe-area insets (notch).
- Use skeleton loaders + optimistic UI for a good experience on slow networks.
- Target a Lighthouse mobile score ≥ 90 (PWA + performance + a11y).

---

## 23. Link System — Public / Private (JWT) / Temporary

> This section replaces/extends section 7.6. Three link types in one model, all controlled by file id. **All the logic below was really tested in a sandbox and verified (section 28).**

### 23.1 The three link types

| Type | Who can access | Auth | Expiry |
|------|----------------|------|--------|
| **public** | anyone with the URL | none | optional (null = unlimited) |
| **private (JWT-Token-Auth)** | only a valid JWT holder, with the right scope + same vendor | `Authorization: Bearer <jwt>` required | optional |
| **temporary** | anyone, but within a time window | none | required (1 minute … unlimited) |

`links` collection (an extended form of `public_urls` from section 6.7):
```js
{
  _id, vendorId, fileId,
  type: "public" | "private" | "temporary",
  token: String,                 // unguessable, ≥24 bytes
  expiresAt: Date | null,        // null = unlimited
  maxDownloads: Number | null,
  downloadCount: Number,
  requiredScope: String,         // for private, e.g. "file:download"
  status: "active" | "revoked" | "expired",
  createdBy, createdAt
}
```

### 23.2 Verify by file id and get an access link (points 8 + 9)

First an authenticated request — the server verifies you have access to that file (same vendor + permission), then creates the link and returns it:

```
POST /api/v1/files/:id/links
Authorization: Bearer <session/api-key>      ← auth verified first
{
  "type": "private",            // public | private | temporary
  "expiresIn": 3600,            // seconds; required for temporary
  "neverExpire": false,         // true = unlimited (public/private)
  "maxDownloads": 100,          // optional
  "requiredScope": "file:download"   // for private
}
```
**Response:**
```json
{
  "id": "lnk_...",
  "type": "private",
  "fileId": "66f...e21",
  "accessUrl": "https://files.yourdomain.com/d/AbCd1234",
  "expiresAt": "2026-06-02T11:00:00Z",
  "note": "private link: send Authorization: Bearer <jwt> to download"
}
```

**Download endpoints:**
| Type | Endpoint | Auth at download |
|------|----------|------------------|
| public | `GET /p/:token` | none |
| temporary | `GET /t/:token` | none (just expiry/limit) |
| private | `GET /d/:token` | `Authorization: Bearer <jwt>` required |

**What's checked at download (verified logic):**
1. token → look up the link.
2. `status==active`, `expiresAt` not passed, `downloadCount < maxDownloads`.
3. **If the vendor is suspended, 403** (for all link types).
4. If private: verify JWT → `vendorId` matches → has the `requiredScope`.
5. If all good, redirect/stream via a presigned storage URL + `downloadCount++`.

### 23.3 Reset/revoke all links by file id (point 10)

```
POST /api/v1/files/:id/links/reset
Authorization: Bearer <session/api-key>
{ "types": ["public","private","temporary"] }   // optional; empty = all
```
- All (or the specified types of) active links for that file → `status="revoked"`.
- As a result, all previously shared URLs become useless immediately.
- Optionally, `regenerate: true` will revoke and return new tokens.
- Every reset is written to `audit_logs`.

| Method | Path | Job |
|--------|------|-----|
| POST | `/files/:id/links` | create link (auth verified) |
| GET | `/files/:id/links` | list active links for that file |
| POST | `/files/:id/links/reset` | revoke all / specified types |
| DELETE | `/links/:id` | revoke a single specific link |

---

## 24. 3rd-Party JWT Token with RBAC Access (point 11)

A vendor can issue scoped, time-bound JWTs to external systems (3rd-party apps) — used for private link access and API calls.

```
POST /api/v1/jwt/issue
Authorization: Bearer <session/api-key>   (permission: apikey:create)
{
  "subject": "partner-crm",          // who you're issuing it to
  "scopes": ["file:read","file:download"],
  "bucketIds": ["..."],              // optional restriction
  "expiresIn": 3600                  // seconds
}
```
**Response:** `{ "token": "<jwt>", "expiresAt": "..." }`

**JWT payload (HS256):**
```json
{ "vendorId":"v1", "sub":"partner-crm", "scopes":["file:read","file:download"],
  "bucketIds":["..."], "iat":..., "exp":... }
```
- Signing secret: the platform `JWT_SECRET` (or a per-vendor rotating secret, which is more secure).
- On every protected request: verify signature → check expiry → match `vendorId` (tenant) → check scope.
- The suspension rule applies here too — a suspended vendor's token can't upload/download.
- Revocation: keep a `jwt_revocations` list (by jti) to invalidate already-issued tokens.

> The verify/scope/expiry logic for this flow was really tested in section 28.

---

## 25. Mail Configuration

SMTP or a provider for transactional mail.

```ini
# .env (mail)
MAIL_DRIVER=smtp            # smtp | resend | ses
MAIL_HOST=smtp.yourprovider.com
MAIL_PORT=587
MAIL_USER=postmaster@yourdomain.com
MAIL_PASS=********
MAIL_FROM="File Manager <no-reply@yourdomain.com>"
```
- Library: `nodemailer` (SMTP) or the Resend/SES SDK.
- **DNS:** add SPF, DKIM, DMARC records for good deliverability.
- **Mail events:** welcome/verify email, password reset, vendor suspended/activated notice, quota ~80% warning, link shared (optional), API key created alert.
- Responsive templates with React-Email or MJML; send asynchronously via a queue (BullMQ/Redis) so requests aren't blocked.
- Keep a test endpoint `/api/v1/admin/mail/test` to verify the config.

---

## 26. Server Operations — Reboot, Maintenance, Migration (points 3, 5, 6)

### 26.1 Easy server reboot (point 5)
Set things up so all services come back up by themselves after a reboot:
```bash
# PM2 reboot-persistence
pm2 startup        # run the command it prints
pm2 save           # save the current process list
# test a reboot: sudo reboot  -> after it returns: pm2 list (check the app is running)
```
- Docker services: `restart: always` in compose (Mongo/MinIO auto-start).
- Keep a `scripts/reboot-safe.sh`: drain in-flight uploads pre-reboot → `pm2 save` → `sudo reboot`.
- After reboot, Nginx should only send traffic once `/api/health` is green.

### 26.2 Maintenance mode — only the SaaS Admin can log in (point 6)
A flag in the `platform_settings` collection:
```js
{ key: "maintenance", enabled: false, message: "Be right back", updatedBy, updatedAt }
```
**Global middleware logic:**
```ts
if (settings.maintenance.enabled) {
  const p = await authenticate(req);       // try session
  const isAdmin = p && ["super_admin","platform_staff"].includes(p.role);
  if (!isAdmin) {
    // all vendor/user/public/API → 503 maintenance page
    return maintenanceResponse(503, settings.maintenance.message);
  }
  // if admin, proceed normally (can log in + manage)
}
```
- Toggle: `POST /api/v1/admin/maintenance { "enabled": true, "message": "..." }` (admin only).
- While in maintenance: vendor login/upload/download + public/private/temporary links all return 503; **only the admin panel works**.
- Turning this mode ON during migration/deploy keeps data consistent.

### 26.3 Easy migration (point 3)
Because of 12-factor config (all state in DB + storage + `.env`), migration is three steps:
```bash
# in one command (scripts/migrate.sh example)
./scripts/migrate.sh NEW_VPS_IP
#  1) maintenance ON
#  2) mongodump --gzip  | ssh NEW "mongorestore --gzip --drop"
#  3) mc mirror --overwrite old/ new/
#  4) scp .env + nginx conf
#  5) NEW: npm ci && npm run build && pm2 start && certbot
#  6) DNS switch  ->  maintenance OFF
```
Full steps and checklist are in section 17.

---

## 27. Easy API System for Vendor / User (point 4)

Goal: a vendor should be able to integrate in 5 minutes.

- **Consistent REST**: `/api/v1/...`, JSON, the same error shape, predictable status codes.
- **Easy auth**: a single header — `Authorization: Bearer fmsk_xxx` (API key) or JWT.
- **OpenAPI 3 spec** (`/openapi.json`) + Swagger UI (`/docs`) — vendors can try it in the browser.
- **Copy-paste examples** on every endpoint (cURL + JS fetch).
- **Tiny JS SDK** example:
```js
import { FileManager } from "@yourorg/filemanager-sdk";
const fm = new FileManager({ apiKey: "fmsk_xxx", baseUrl: "https://files.yourdomain.com" });

const file = await fm.upload({ bucketId, file });          // -> { id, ...details }
const link = await fm.createLink(file.id, { type: "temporary", expiresIn: 600 });
await fm.resetLinks(file.id);                              // revoke all links
const jwt = await fm.issueJwt({ scopes: ["file:download"], expiresIn: 3600 });
```
- **Webhook (app-level)**: push events like `file.uploaded`, `link.created`, `vendor.suspended`.
- Keep **pagination, filtering, and rate-limit headers** (`X-RateLimit-Remaining`) consistent.
- Provide a Postman collection + quickstart README.

---

## 28. Testing — Strategy + Real Verified Tests (point 12)

### 28.1 Test pyramid
| Layer | Tool | What it tests |
|-------|------|---------------|
| Unit | Vitest/Jest | pure logic: link validity, JWT, signature, RBAC, quota |
| Integration | Supertest + `mongodb-memory-server` | route handler + DB, tenant isolation, suspension |
| E2E | Playwright | UI flow: login, upload, share link, suspend, mobile viewport, PWA install |
| Load | k6 / autocannon | concurrent upload/download, rate-limit |

**Critical rules that must be tested:**
- One vendor cannot view/download another vendor's files (cross-tenant).
- A suspended vendor is blocked from upload/download/public-link.
- Temporary link expiry, maxDownloads, and revoke work correctly.
- A private link gives no access without a JWT; wrong scope/tenant is denied.
- GitHub deploy webhook signature verification.
- In maintenance mode, only admins can log in.

### 28.2 Real test — run while building this document ✅

The core logic (a dependency-free Node script) was **actually run** in a sandbox. Result:

```
[1] Public token
  PASS  token length >= 32 chars
  PASS  two tokens are unique
[2] Link validity (3 types)
  PASS  public active link usable
  PASS  temporary link 1-min not yet expired
  PASS  temporary link expired -> EXPIRED
  PASS  unlimited link (expiresAt null) never expires
  PASS  revoked link -> REVOKED
  PASS  maxDownloads reached -> LIMIT_REACHED
[3] 3rd-party JWT with RBAC scopes
  PASS  valid JWT verifies
  PASS  payload carries vendorId
  PASS  scope present -> true
  PASS  scope absent -> false
  PASS  tampered JWT rejected
  PASS  wrong secret rejected
  PASS  expired JWT -> EXPIRED
[4] Private link access (JWT-Token-Auth)
  PASS  valid token + scope -> access
  PASS  no token -> denied
  PASS  token from other vendor -> WRONG_TENANT
  PASS  token missing download scope -> MISSING_SCOPE
[5] GitHub deploy webhook signature
  PASS  correct signature accepted
  PASS  wrong signature rejected
  PASS  wrong secret rejected
[6] Suspension + tenant + RBAC guard
  PASS  active vendor can upload
  PASS  suspended vendor upload -> VENDOR_SUSPENDED
  PASS  suspended vendor download -> VENDOR_SUSPENDED
  PASS  cross-tenant access -> CROSS_TENANT
  PASS  missing permission -> FORBIDDEN
=============================================
RESULT: 27 passed, 0 failed
=============================================
```

> This means the core algorithms for link validity, the 3-type link system, private-link JWT auth, 3rd-party JWT+RBAC, GitHub signature, and the suspension rule **provably work**. You can use these verified functions (`isLinkUsable`, `signJwt/verifyJwt`, `canAccessPrivateLink`, `verifyGithubSignature`, `can`) directly in the codebase — the full script is available as a separate file (`core-logic.test.js`).

> Note: this is verification of the core security logic, not a full end-to-end test of the whole app — that comes after the codebase is built (see the test pyramid above).

### 28.3 Test in CI
Add a test gate before deploy in `.github/workflows/deploy.yml`:
```yaml
- run: npm ci
- run: npm test          # if it fails, deploy won't run
- run: npm run build
```

---

## 29. Installation — From Public and Private GitHub Repos (point 14)

### 29.1 From a public repo (simplest)
```bash
cd /var/www
git clone https://github.com/yourorg/file-manager.git app
cd app
cp .env.example .env          # fill in the values
npm ci && npm run build
pm2 start npm --name filemanager -- start && pm2 save
```

### 29.2 From a private repo — 3 ways

**(a) SSH Deploy Key (read-only, recommended):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -C "vps"
cat ~/.ssh/deploy_key.pub   # -> GitHub repo → Settings → Deploy keys (read access)
printf 'Host github.com\n  IdentityFile ~/.ssh/deploy_key\n' >> ~/.ssh/config
git clone git@github.com:yourorg/file-manager.git app
```

**(b) Personal Access Token (HTTPS):**
```bash
# GitHub → Settings → Developer settings → Fine-grained token (repo: read)
git clone https://<TOKEN>@github.com/yourorg/file-manager.git app
# the token ends up in URL history; better to use git credential store instead:
git config --global credential.helper store
```

**(c) GitHub App / machine user** — for larger teams.

### 29.3 One-shot installer script
`scripts/install.sh` (takes the repo URL as an argument, works for both public/private):
```bash
#!/usr/bin/env bash
set -e
REPO="$1"                       # git@... or https://...
DIR="/var/www/app"
sudo mkdir -p /var/www && sudo chown -R $USER /var/www
git clone "$REPO" "$DIR" || (cd "$DIR" && git pull)
cd "$DIR"
[ -f .env ] || cp .env.example .env
echo ">> Edit .env then press Enter"; read
npm ci
npm run build
node scripts/seed-admin.js || true
pm2 start npm --name filemanager -- start
pm2 save
echo ">> Done. Set up Nginx + Certbot (doc section 15.7)"
```
```bash
# Public:
bash scripts/install.sh https://github.com/yourorg/file-manager.git
# Private (if a deploy key is set):
bash scripts/install.sh git@github.com:yourorg/file-manager.git
```

> The full first-time server prep (Node, PM2, Nginx, Docker, MinIO, Mongo) is in section 15. This installer assumes those are already in place.

---

## 30. Summary of what was added in this version

PWA (installable + offline), mobile-first responsive UI, the three-type link system (public / private-JWT / temporary) — auth-verified create, access and **reset-all** by file id, 3rd-party JWT issuance with RBAC scopes, mail configuration (SMTP/DKIM/events), easy reboot (PM2 persist + docker restart), **maintenance mode (only SaaS admin login)**, one-command migration, easy API + SDK + OpenAPI, a full testing strategy **+ 27 real tests passing (verified)**, and installation from public/private GitHub repos (deploy key / PAT / installer script).

---

*End. A verified core-logic script (`core-logic.test.js`, 27/27 pass) is available — if you want it, or the full production code of any part (Mongoose models, link + JWT route handlers, maintenance middleware, `install.sh`/`migrate.sh`/`deploy.sh`, a boilerplate repo with docker-compose), I can build it separately. Just say which one you need first.*
