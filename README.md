# File Manager SaaS

Multi-tenant file manager — **Next.js (App Router) + MongoDB + MinIO (S3-compatible)**.
Two panels (Admin + Vendor), full RBAC, 3 link types (public / private / temporary),
3rd-party JWT issuance, vendor suspension, maintenance mode, PWA, and one-command Ubuntu VPS install.

> Reference spec: [`file-manager-saas-complete-EN.md`](./file-manager-saas-complete-EN.md)
> Feature summary you can hand to a stakeholder: [`FEATURES.md`](./FEATURES.md)

---

## What's in this repo

```
app/                  Next.js App Router (UI + API)
  (admin)/admin/      Admin panel UI
  (vendor)/dashboard/ Vendor panel UI
  p/[token]/          public download
  t/[token]/          temporary download
  d/[token]/          private (JWT-Token-Auth) download
  api/v1/             REST API (auth, admin, buckets, files, links, jwt, ...)
  api/health/         /api/health — DB + storage liveness
  api/internal/cron/  expire-urls, purge-trash
lib/                  db, auth, rbac, storage, jwt, links, mail, ratelimit, audit, ...
models/               Mongoose schemas
public/               manifest.webmanifest, sw.js, /icons
scripts/              install.sh, deploy.sh, migrate.sh, backup.sh, seed-admin.js, reboot-safe.sh
nginx/                filemanager.conf
tests/                core-logic.test.js  (27 verified tests)
ecosystem.config.js   PM2 process manifest
docker-compose.yml    Mongo + MinIO (localhost-bound)
.github/workflows/    deploy.yml (CI gate + SSH deploy)
middleware.ts         security headers + request id
```

---

## Quick start (blank Ubuntu 22.04/24.04)

```bash
# 1) Clone (public)
git clone https://github.com/yourorg/file-manager.git app
cd app

# 2) Configure
cp .env.example .env
# edit .env — fill in JWT_SECRET, MONGODB_URI, S3_* (or accept the localhost defaults)

# 3) Install + run (one command does it all)
bash scripts/install.sh https://github.com/yourorg/file-manager.git
```

The installer handles: Node 20 + nginx + UFW + Docker + MinIO/Mongo via compose +
PM2 + Certbot + the first super_admin seed.

Manual route, equivalent:

```bash
# infra
sudo docker compose up -d
# app
npm ci && npm run build
node scripts/seed-admin.js --email you@x.com --password 'changeme123'
pm2 start ecosystem.config.js && pm2 save && pm2 startup
# nginx + ssl
sudo cp nginx/filemanager.conf /etc/nginx/sites-available/filemanager
sudo ln -s /etc/nginx/sites-available/filemanager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d files.yourdomain.com
```

`scripts/install.sh` is idempotent — re-running it pulls latest and re-builds.

---

## Local development

```bash
npm i
cp .env.example .env
# Either point .env at running MongoDB + MinIO, or:
docker compose up -d
node scripts/seed-admin.js --email dev@local --password 'devdevdev'
npm run dev      # http://localhost:3000
```

---

## API at a glance

```bash
# Upload (returns id + full details)
curl -X POST https://files.yourdomain.com/api/v1/buckets/$BID/files \
  -H "Authorization: Bearer fmsk_xxx" -F file=@invoice.pdf

# Create a 1-minute temporary link
curl -X POST https://files.yourdomain.com/api/v1/files/$FID/links \
  -H "Authorization: Bearer fmsk_xxx" \
  -d '{"type":"temporary","expiresIn":60}'

# Reset ALL links for a file
curl -X POST https://files.yourdomain.com/api/v1/files/$FID/links/reset \
  -H "Authorization: Bearer fmsk_xxx" -d '{}'

# Issue a 3rd-party JWT
curl -X POST https://files.yourdomain.com/api/v1/jwt/issue \
  -H "Authorization: Bearer fmsk_xxx" \
  -d '{"subject":"partner","scopes":["file:download"],"expiresIn":3600}'
```

Download routes: `/p/:token` (public), `/t/:token` (temporary), `/d/:token` (private — `Authorization: Bearer <jwt>` required).

---

## Tests

```bash
npm test    # core-logic.test.js — 27 verified security tests (link, jwt, github sig, suspension, rbac)
```

CI gate: `.github/workflows/deploy.yml` runs `npm test` before SSH-deploy. Failing tests block the deploy.

---

## Security

- All queries scoped by `vendorId` — cross-tenant access blocked
- Argon2id passwords
- API keys: only SHA-256 hash stored; plain key shown once
- Suspension enforced on upload + download + all 3 link types
- Public tokens unguessable (≥ 24 bytes)
- HTTPS-only secure cookies, security headers added by middleware
- zod validation on every route
- Audit log on every state change

---

## Ops — one-command for everything

| Action | Command |
|--------|---------|
| First install on blank Ubuntu | `bash scripts/install.sh <REPO_URL>` |
| **Pull latest from GitHub + rebuild + reload (zero downtime)** | `bash scripts/update.sh` |
| Install cron jobs (expire-links, purge-trash, recount, backup) | `bash scripts/setup-cron.sh` |
| Local health check (DB + storage) | `bash scripts/healthcheck.sh` |
| Migrate to a new VPS | `./scripts/migrate.sh user@new.vps.ip` |
| Reboot-safe shutdown | `bash scripts/reboot-safe.sh` |
| Daily backup (cron job runs this) | `bash scripts/backup.sh` |
| Invoked by GitHub deploy webhook | `scripts/deploy.sh` (do not call manually) |

**Maintenance mode**: Admin panel → Maintenance → toggle. While on, only platform admins can sign in; everything else returns `503 MAINTENANCE`. Turn it on before migration.

**The full pull-and-update flow you described**:
```bash
ssh you@vps
cd /var/www/app
bash scripts/update.sh        # one command — pull, test, build, pm2 reload
```
Or push to `main` and the GitHub webhook does it automatically.

---

## License

Proprietary — internal SaaS.
