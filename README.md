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

## 🚀 One-click install on a blank Ubuntu VPS

Point your DNS A record at the VPS first (`files.yourdomain.com → 1.2.3.4`), then **paste this one command**:

```bash
curl -fsSL https://raw.githubusercontent.com/BetaZen-InfoTech/file-manager/main/scripts/bootstrap.sh \
  | sudo bash -s -- \
      --domain files.yourdomain.com \
      --email you@yourdomain.com \
      --admin-email admin@yourdomain.com \
      --admin-pass 'StrongPassword123'
```

The bootstrap does everything: apt update → Node 20 + Docker + Nginx + Certbot + PM2 →
clone repo → **auto-generate `.env` with random secrets** (chmod 600) → start Mongo + MinIO via compose →
`npm ci && npm test && npm run build` → seed super_admin → Nginx vhost + Let's Encrypt SSL →
install cron jobs → PM2 boot-time autostart. Takes ~5–10 minutes. **Idempotent — safe to re-run.**

When it finishes, hit `https://files.yourdomain.com/login`. The end-of-run summary prints
the auto-generated GitHub webhook secret to paste into your repo's Settings → Webhooks.

**bootstrap.sh flags:**

| Flag | Purpose | Default |
|------|---------|---------|
| `--domain <fqdn>` | needed for SSL + Nginx vhost | – |
| `--email <addr>` | for Let's Encrypt | – |
| `--repo <url>` | source repo | this one |
| `--branch <name>` | branch to deploy | `main` |
| `--dir <path>` | install location | `/var/www/app` |
| `--admin-email`, `--admin-pass` | seed first super_admin | (skip — do it later) |
| `--skip-ssl` | use if DNS not ready; re-run certbot later | off |

---

## Manual install (each step explicit, equivalent to bootstrap)

```bash
# 1) Clone
git clone https://github.com/BetaZen-InfoTech/file-manager.git /var/www/app && cd /var/www/app
# 2) Configure
cp .env.example .env       # fill in JWT_SECRET, MONGODB_URI, S3_*, etc.
# 3) Installer (one command — same heavy lifting as bootstrap minus DNS-aware SSL)
bash scripts/install.sh https://github.com/BetaZen-InfoTech/file-manager.git
# 4) Cron jobs
bash scripts/setup-cron.sh
# 5) Nginx + SSL
sudo cp nginx/filemanager.conf /etc/nginx/sites-available/filemanager
sudo ln -s /etc/nginx/sites-available/filemanager /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d files.yourdomain.com
```

Either way: `scripts/install.sh` and `scripts/bootstrap.sh` are idempotent — re-run anytime to apply updates.

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
