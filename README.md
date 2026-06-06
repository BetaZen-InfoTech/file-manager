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

## 🚀 Single-file install on a blank Ubuntu VPS

**One script does everything**: [`scripts/setup.sh`](scripts/setup.sh) — base packages, Node 20, Docker, MinIO, Mongo, Nginx, Certbot SSL, PM2 boot-time autostart, auto-generated `.env` with strong random secrets, super_admin seed, cron jobs, and a post-install health check. ~5–10 min. Idempotent (safe to re-run).

### Public repo — one command

Point DNS at the VPS first, then:

```bash
curl -fsSL https://raw.githubusercontent.com/BetaZen-InfoTech/file-manager/main/scripts/setup.sh \
  | sudo bash -s -- \
      --domain files.yourdomain.com \
      --email you@yourdomain.com \
      --admin-email admin@yourdomain.com \
      --admin-pass 'StrongPassword123'
```

### Private repo — clone first, then run

Because the raw script isn't fetchable without auth, set up a deploy key once (instructions in §"Private repo setup" below), then:

```bash
sudo git clone git@github.com:BetaZen-InfoTech/file-manager.git /var/www/app
sudo bash /var/www/app/scripts/setup.sh \
  --domain cdn.betazeninfotech.com \
  --email you@betazeninfotech.com \
  --repo git@github.com:BetaZen-InfoTech/file-manager.git \
  --admin-email admin@betazeninfotech.com \
  --admin-pass 'StrongPassword!'
```

### Interactive mode (no flags)

```bash
sudo bash /var/www/app/scripts/setup.sh
```
…prompts for domain, email, repo, admin credentials.

### All flags

| Flag | Purpose | Default |
|------|---------|---------|
| `--domain <fqdn>` | for SSL + Nginx vhost (required) | – |
| `--email <addr>` | for Let's Encrypt (required unless `--skip-ssl`) | – |
| `--repo <url>` | repo URL (SSH for private, HTTPS for public) | this repo |
| `--branch <name>` | deploy branch | `main` |
| `--dir <path>` | install location | `/var/www/app` |
| `--admin-email`, `--admin-pass` | seed first super_admin (≥ 8 chars) | (skip; seed later) |
| `--skip-ssl` | use if DNS isn't ready yet; re-run certbot later | off |
| `--skip-dns-check` | don't verify A record matches the VPS public IP | off |
| `--reset` | wipe DB + MinIO volumes (DANGER — fresh install) | off |
| `--interactive` / `-i` | force interactive prompts | off |
| `--verbose` / `-v` | shell trace + verbose | off |

When `setup.sh` finishes, it writes `/root/file-manager-install-report.txt` (`chmod 600`) with the URL, webhook secret to paste into GitHub, and S3 keys.

---

## Private repo setup (one-time, ~2 min)

```bash
# On the VPS:
sudo ssh-keygen -t ed25519 -f /root/.ssh/deploy_key -N '' -C "vps-$(hostname)"
sudo cat /root/.ssh/deploy_key.pub
# Copy that line → github.com/BetaZen-InfoTech/file-manager/settings/keys → Add deploy key (read-only)

sudo tee -a /root/.ssh/config >/dev/null <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/deploy_key
  IdentitiesOnly yes
EOF
sudo chmod 600 /root/.ssh/config
sudo ssh-keyscan -t ed25519 github.com | sudo tee -a /root/.ssh/known_hosts >/dev/null
sudo ssh -T git@github.com   # should say "Hi BetaZen-InfoTech/file-manager! …"
```

Then run setup.sh with `--repo git@github.com:BetaZen-InfoTech/file-manager.git` as shown above.

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
