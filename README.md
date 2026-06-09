<div align="center">

# File Manager SaaS

**A multi-tenant, self-hosted file-management & secure-link platform by [BetaZen InfoTech](https://betazeninfotech.com).**

[![License](https://img.shields.io/badge/license-Proprietary-orange)](#13-license-copyright--trademarks)
[![Platform](https://img.shields.io/badge/platform-Ubuntu%2022.04%20%2F%2024.04-E95420)](#2-system-requirements)
[![Node](https://img.shields.io/badge/Node-20.x-339933)](https://nodejs.org)
[![Next.js](https://img.shields.io/badge/Next.js-App_Router-000000)](https://nextjs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7.0%2B-47A248)](https://www.mongodb.com)
[![Storage](https://img.shields.io/badge/storage-MinIO_S3-C72E49)](https://min.io)

[Features](#3-what-you-get) · [Install](#5-installation) · [Upgrade](#8-upgrading) · [API](#11-api-reference) · [Security](#12-security) · [License](#13-license-copyright--trademarks)

</div>

---

> **Copyright (c) 2024–2026 BetaZen InfoTech. All rights reserved.**
> Proprietary — internal SaaS. Source is provided for self-hosting and audit; commercial
> redistribution or competing hosted services require a separate written agreement.

---

## Table of contents

1. [Overview](#1-overview)
2. [System requirements](#2-system-requirements)
3. [What you get](#3-what-you-get)
4. [Architecture](#4-architecture)
5. [Installation](#5-installation)
    - 5.1 [One-line install (recommended)](#51-one-line-install-recommended)
    - 5.2 [Private repo — via GitHub token](#52-private-repo--via-github-token)
    - 5.3 [Private repo — via deploy key](#53-private-repo--via-deploy-key)
    - 5.4 [Install flags](#54-install-flags)
    - 5.5 [What the installer actually does](#55-what-the-installer-actually-does)
    - 5.6 [Post-install verification](#56-post-install-verification)
    - 5.7 [Hardening checklist](#57-hardening-checklist)
6. [First login](#6-first-login)
7. [Development setup](#7-development-setup)
8. [Upgrading](#8-upgrading)
    - 8.1 [Fast path (production)](#81-fast-path-production)
    - 8.2 [Automatic on `git push`](#82-automatic-on-git-push-github-webhook)
    - 8.3 [Rollback](#83-rollback)
9. [Migrating to a new VPS](#9-migrating-to-a-new-vps)
10. [Common commands](#10-common-commands)
11. [API reference](#11-api-reference)
12. [Security](#12-security)
13. [License, copyright & trademarks](#13-license-copyright--trademarks)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

File Manager SaaS is a **multi-tenant file manager** that runs from a single Next.js (App Router)
backend, backed by **MongoDB** for state and **MinIO** (S3-compatible) for object storage. It ships
two panels — an **Admin** panel for platform owners and a **Vendor** panel for tenants — with full
RBAC, three distinct secure-link types, 3rd-party JWT issuance, and one-command Ubuntu VPS install.

**Who it is for:**

- SaaS operators who need per-tenant file storage with isolated buckets and usage accounting.
- Agencies handing clients a self-service portal for uploads and shareable links.
- Teams that want public / time-limited / token-authenticated download links without building auth.
- Developers who want a "push to `main` → auto-deploy" file backend on their own VPS.

**Who it is NOT for:**

- Anyone wanting to re-skin and resell it as their own SaaS — forbidden without a written agreement.

---

## 2. System requirements

### 2.1 Supported operating systems

| OS | Version | Support |
|---|---|---|
| Ubuntu Server | 22.04 LTS | ✅ Primary (installer tested here) |
| Ubuntu Server | 24.04 LTS | ✅ Primary |
| Debian | 12 (bookworm) | ⚠️ Best-effort; minor tweaks may be needed |
| RHEL / Rocky / Alma | 9.x | ❌ Not supported (installer is apt-based) |
| macOS / Windows | any | 🧪 Development only (`npm run dev`); never production |

### 2.2 Hardware minimums

| Profile | CPU | RAM | Disk | Use-case |
|---|---|---|---|---|
| Evaluation | 1 vCPU | 2 GB | 20 GB SSD | Kick the tyres, no real tenants. |
| Small production | 2 vCPU | 4 GB | 40 GB SSD | Light tenant load, modest object storage. |
| Standard production | 4 vCPU | 8 GB | 80+ GB SSD | Many tenants; consider MinIO on its own volume. |

### 2.3 Network prerequisites

- **A public IPv4** on the VPS.
- **A DNS A record** pointing your domain (e.g. `cdn.betazeninfotech.com`) at the server **before
  install** — required for Let's Encrypt SSL (or install with `--skip-ssl` and add it later).
- **Inbound ports:** `22/tcp` (SSH), `80/tcp`, `443/tcp`. MongoDB and MinIO are bound to
  `127.0.0.1` and never exposed.

---

## 3. What you get

- **Admin panel** at `/admin/*` — platform owner administration: vendors, usage, audit, maintenance.
- **Vendor panel** at `/dashboard/*` — buckets, files, links, API keys, team members.
- **Three secure-link types:**
  - **Public** (`/p/:token`) — unguessable, shareable, never expires until revoked.
  - **Temporary** (`/t/:token`) — time-boxed, auto-expires (cron sweep every 5 min).
  - **Private** (`/d/:token`) — requires `Authorization: Bearer <jwt>`.
- **3rd-party JWT issuance** — mint scoped, expiring tokens for partner integrations.
- **Vendor suspension** — enforced on upload + download + all three link types.
- **Maintenance mode** — server-wide; only platform admins can sign in, everything else returns `503`.
- **API keys** — `fmsk_*` bearer tokens; only the SHA-256 hash is stored, plaintext shown once.
- **PWA** — installable, with manifest + service worker.
- **Audit trail** — every state change logged with actor, tenant, and before/after.
- **One-command install** — base packages, Node, Docker, Mongo, MinIO, Nginx, SSL, PM2, cron, seed.

> 📖 Full feature catalogue: [`FEATURES.md`](./FEATURES.md) ·
> Reference spec: [`file-manager-saas-complete-EN.md`](./file-manager-saas-complete-EN.md)

---

## 4. Architecture

```
                    Single domain (cdn.betazeninfotech.com)
        +------------------------------------------------------+
        |  /admin/*        - Admin panel (Next.js)             |
        |  /dashboard/*    - Vendor panel (Next.js)            |
        |  /api/v1/*       - REST API                          |
        |  /p|/t|/d/:token - public / temp / private downloads |
        +-----------------------+------------------------------+
                                |
                     nginx reverse proxy (systemd: nginx)
                                |
                     Next.js (PM2: filemanager, port 3000)
                                |
                  +-------------+-------------+
                  |                           |
            MongoDB 7.0+                  MinIO (S3)
            (127.0.0.1:27017)            (127.0.0.1:9000)
            via docker compose           via docker compose
```

| Tier | Technology |
|---|---|
| Backend / UI | Next.js (App Router), TypeScript, Tailwind CSS |
| Database | MongoDB 7.0+ via Mongoose (`authSource=admin`) |
| Object storage | MinIO (S3-compatible), path-style, localhost-bound |
| Auth | Argon2id passwords, JWT, secure HTTP-only cookies |
| Web server | nginx (reverse proxy) |
| TLS | Let's Encrypt via certbot (auto-renew) |
| Process supervision | PM2 (boot-time autostart) |
| Infra | Docker + docker compose (Mongo + MinIO) |
| CI/CD | GitHub Actions → webhook deploy |

---

## 5. Installation

Install on a **fresh Ubuntu 22.04 or 24.04 VPS**. The installer
([`scripts/setup.sh`](scripts/setup.sh)) is **idempotent** — re-running it pulls the latest `main`,
rebuilds, and reloads without touching your `.env` or data.

### 5.1 One-line install (recommended)

Point DNS at the VPS first, then:

**Interactive** — press Enter to accept the defaults (`cdn.betazeninfotech.com`,
`admin@cdn.betazeninfotech.com`, auto-generated password):

```bash
sudo bash <(curl -fsSL https://raw.githubusercontent.com/BetaZen-InfoTech/file-manager/main/scripts/setup.sh)
```

**Fully unattended:**

```bash
curl -fsSL https://raw.githubusercontent.com/BetaZen-InfoTech/file-manager/main/scripts/setup.sh \
  | sudo bash -s -- \
      --domain files.yourdomain.com \
      --email you@yourdomain.com \
      --admin-email admin@yourdomain.com \
      --admin-pass 'StrongPassword123'
```

Takes **5–10 minutes**. The admin password is printed at the end and saved (with the webhook secret
and S3 keys) to `/root/file-manager-install-report.txt` (`chmod 600`).

### 5.2 Private repo — via GitHub token

If the repo is private, use a fine-grained PAT (this repo, **Contents: Read-only**) or a classic
`ghp_*` token (`repo` scope). The token authenticates both the script download **and** the clone:

```bash
export GH_TOKEN=github_pat_xxx   # or ghp_xxx

curl -fsSL \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github.raw" \
  https://api.github.com/repos/BetaZen-InfoTech/file-manager/contents/scripts/setup.sh \
| sudo bash -s -- \
    --domain files.yourdomain.com \
    --email you@yourdomain.com \
    --repo "https://x-access-token:$GH_TOKEN@github.com/BetaZen-InfoTech/file-manager.git" \
    --admin-email admin@yourdomain.com \
    --admin-pass 'StrongPassword123'
```

> ⚠️ The token is persisted in `/var/www/app/.git/config` (so auto-deploy keeps working) and lands
> in your shell history. Use a read-only, expiring token; run `unset GH_TOKEN` afterwards.

### 5.3 Private repo — via deploy key

A one-time SSH deploy key avoids embedding a token:

```bash
sudo ssh-keygen -t ed25519 -f /root/.ssh/deploy_key -N '' -C "vps-$(hostname)"
sudo cat /root/.ssh/deploy_key.pub
# Copy → github.com/BetaZen-InfoTech/file-manager/settings/keys → Add deploy key (read-only)

sudo tee -a /root/.ssh/config >/dev/null <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/deploy_key
  IdentitiesOnly yes
EOF
sudo chmod 600 /root/.ssh/config
sudo ssh-keyscan -t ed25519 github.com | sudo tee -a /root/.ssh/known_hosts >/dev/null

sudo git clone git@github.com:BetaZen-InfoTech/file-manager.git /var/www/app
sudo bash /var/www/app/scripts/setup.sh \
  --domain cdn.betazeninfotech.com \
  --email you@betazeninfotech.com \
  --repo git@github.com:BetaZen-InfoTech/file-manager.git
```

### 5.4 Install flags

All flags are optional — anything omitted uses the built-in default (centralized at the top of
[`scripts/setup.sh`](scripts/setup.sh)).

| Flag | Purpose | Default |
|------|---------|---------|
| `--domain <fqdn>` | SSL + Nginx vhost | `cdn.betazeninfotech.com` |
| `--email <addr>` | Let's Encrypt registration | falls back to `admin@<domain>` |
| `--admin-email <addr>` | first super_admin email | `admin@<domain>` |
| `--admin-pass <pw>` | first super_admin password (≥ 8 chars) | **auto-generated**, shown in report |
| `--repo <url>` | repo URL (SSH / HTTPS / token) | this repo |
| `--branch <name>` | deploy branch | `main` |
| `--dir <path>` | install location | `/var/www/app` |
| `--skip-ssl` | skip Certbot (DNS not ready yet) | off |
| `--skip-dns-check` | don't verify the A record matches the VPS IP | off |
| `--reset` | ⚠️ wipe DB + MinIO volumes (fresh install) | off |
| `--interactive` / `-i` | force prompts | off |
| `--verbose` / `-v` | shell trace | off |

### 5.5 What the installer actually does

In order:

1. **Root / OS check** — refuses non-root; warns on non-Ubuntu.
2. **DNS pre-check** — verifies the A record resolves to the VPS IP (skip with `--skip-dns-check`).
3. **Base packages** — curl, git, nginx, ufw, fail2ban, openssl, jq, rsync.
4. **Node 20 + PM2**, then **Docker + compose plugin**, then **Certbot**.
5. **UFW firewall** — opens only SSH + 80 + 443.
6. **Repo clone / update** into `/var/www/app`.
7. **`.env`** — auto-generated with strong random secrets (JWT, session, S3, Mongo, cron, webhook).
8. **Infra** — Mongo + MinIO via `docker compose`, waits for both healthy.
9. **`npm ci` → `npm test` → `npm run build`** (tests gate the build).
10. **Seed first super_admin** — `admin@<domain>` with the given or an auto-generated password.
11. **PM2** — start + `pm2 save` + boot-time autostart.
12. **Nginx vhost** for the domain, then **Let's Encrypt SSL** (`--redirect`).
13. **Cron jobs** — expire links, purge trash, recount usage, orphan sweep, nightly backup.
14. **Health check** + writes `/root/file-manager-install-report.txt`.

The installer **does not** overwrite an existing `.env`, and `--reset` is the only thing that wipes data.

### 5.6 Post-install verification

```bash
# 1) App process
pm2 status

# 2) Health endpoint (DB + storage liveness)
curl -s http://127.0.0.1:3000/api/health | jq
# -> { "ok": true, ... }

# 3) Public HTTPS answers
curl -sI https://<your-domain>/login | head -5

# 4) Infra healthy
docker compose -f /var/www/app/docker-compose.yml ps
```

If anything fails, check `pm2 logs filemanager` and `/var/log/fms-setup.log` first.

### 5.7 Hardening checklist

- [ ] **Change the seeded admin password** after first login.
- [ ] **Confirm secrets are randomized** in `/var/www/app/.env` (the installer does this).
- [ ] **Lock SSH** — key-based auth only, ideally a non-default port behind ufw.
- [ ] **Add the GitHub deploy webhook** (see §8.2) and store the secret safely.
- [ ] **Configure mail** (`MAIL_DRIVER=smtp` + creds) then `pm2 reload filemanager --update-env`.
- [ ] **Verify nightly backups** are running (`/var/log/fms-backup.log`).

---

## 6. First login

1. Navigate to `https://<your-domain>/login`.
2. Sign in with the seeded super_admin:
   - **Email:** `admin@<your-domain>` (or whatever you passed to `--admin-email`)
   - **Password:** the one you set, or the auto-generated one in `/root/file-manager-install-report.txt`
3. **Change the password immediately.**
4. Create your first vendor from the Admin panel. Vendors sign in at the same `/login` and land in
   `/dashboard/*`; platform admins land in `/admin/*`.

---

### 6.1 `bcdnp` — root admin console

Every install ships a global **`bcdnp`** command (BetaZen CDN Panel) — an interactive, numbered
menu for the common server-side tasks, so you don't have to remember individual commands. Run it as
root:

```bash
sudo bcdnp                 # interactive menu
sudo bcdnp restart         # jump straight to one action
sudo bcdnp ssl             # … by name or number
```

```
  BetaZen CDN Panel — admin console (bcdnp)
  Panel:  https://cdn.betazeninfotech.com/login
  Server: 203.0.113.10   ·   App: /var/www/app   ·   pm2: filemanager
 ---------------------------------------------------------------
   1) Open panel info (URL + IP)        10) Resolve server issues (auto-heal)
   2) Domain setup (change domain)      11) Update from GitHub (pull+build)
   3) Issue / renew SSL certificate     12) Health check
   4) Force HTTPS (redirect)            13) View panel logs
   5) Update super admin email          14) Toggle maintenance mode
   6) Update super admin password       15) Backup now
   7) Reload MongoDB from .env          16) Show install report / secrets
   8) Restart panel (pm2 reload)        17) Edit .env
   9) Restart nginx                     18) Status (pm2 + docker + nginx)
                                         0) Quit
```

| # | Name | What it does |
|---|------|--------------|
| 1 | `open` | Print the panel URL + the public IP (open `http://<ip>/login` in a browser). |
| 2 | `domain` | Change the domain — rewrites `.env` + the Nginx vhost, reloads, offers SSL. |
| 3 | `ssl` | Issue / renew the Let's Encrypt certificate (certbot). |
| 4 | `https` | Force the HTTP → HTTPS redirect. |
| 5 | `email` | Update the super_admin email. |
| 6 | `password` | Update the super_admin password (argon2id). |
| 7 | `mongo` | Re-test the `MONGODB_URI` from `.env` and reload the panel. |
| 8 | `restart` | Zero-downtime PM2 reload of the panel. |
| 9 | `nginx` | `nginx -t` then reload. |
| 10 | `heal` | Auto-heal: bring up Mongo/MinIO, restart panel + nginx, disk + health check. |
| 11 | `update` | Run `scripts/update.sh` (pull + test + build + reload). |
| 12 | `health` | Hit `/api/health`. |
| 13 | `logs` | Tail the panel logs. |
| 14 | `maintenance` | Toggle maintenance mode. |
| 15 | `backup` | Run a backup now. |
| 16 | `report` | Show `/root/file-manager-install-report.txt` (URL, secrets, keys). |
| 17 | `env` | Edit `.env`, then optionally reload. |
| 18 | `status` | PM2 + Docker + Nginx status at a glance. |

---

## 7. Development setup

```bash
git clone https://github.com/BetaZen-InfoTech/file-manager.git
cd file-manager

npm i
cp .env.example .env            # point at local Mongo + MinIO, or use docker compose
docker compose up -d            # local Mongo + MinIO
node scripts/seed-admin.js --email dev@local --password 'devdevdev'
npm run dev                     # http://localhost:3000
```

Run the security test suite anytime:

```bash
npm test    # core-logic.test.js — 27 verified tests (links, jwt, github sig, suspension, rbac)
```

---

## 8. Upgrading

### 8.1 Fast path (production)

```bash
ssh you@your-vps
cd /var/www/app
bash scripts/update.sh
```

[`scripts/update.sh`](scripts/update.sh) runs the full safe pipeline and **only reloads if tests pass**:

```
git fetch → reset --hard origin/main → npm ci → npm test → npm run build → pm2 reload (zero downtime)
```

Already up to date? It exits early. Force a rebuild with `FORCE=1 bash scripts/update.sh`. Or simply
re-run the installer — it's idempotent and performs the same pull-and-rebuild.

### 8.2 Automatic on `git push` (GitHub webhook)

Add a webhook so pushing to `main` auto-deploys:

1. **Repo → Settings → Webhooks → Add webhook**
2. **Payload URL:** `https://<your-domain>/api/v1/deploy/github`
3. **Content type:** `application/json`
4. **Secret:** the `GITHUB_WEBHOOK_SECRET` from `/root/file-manager-install-report.txt`
5. **Events:** *Just the push event*

Every `git push origin main` then triggers [`scripts/deploy.sh`](scripts/deploy.sh) (CI-gated by
`npm test`) on the server. Don't run `deploy.sh` by hand — it's webhook-driven.

### 8.3 Rollback

```bash
cd /var/www/app
git reset --hard <previous-commit>
bash scripts/update.sh
```

Restore data from the nightly backups (`scripts/backup.sh`) if a migration needs reverting.

---

## 9. Migrating to a new VPS

```bash
./scripts/migrate.sh user@new.vps.ip
```

Turn on **Maintenance mode** (Admin panel → Maintenance) before migrating so no writes happen
mid-copy. The script syncs the app, `.env`, and data volumes to the new host.

---

## 10. Common commands

| Action | Command |
|--------|---------|
| First install on blank Ubuntu | `bash scripts/setup.sh` |
| **Upgrade** (pull + test + build + zero-downtime reload) | `bash scripts/update.sh` |
| Install/refresh cron jobs | `bash scripts/setup-cron.sh` |
| Local health check | `bash scripts/healthcheck.sh` |
| Migrate to a new VPS | `./scripts/migrate.sh user@new.vps.ip` |
| Reboot-safe shutdown | `bash scripts/reboot-safe.sh` |
| Manual backup (cron runs nightly) | `bash scripts/backup.sh` |
| Re-seed an admin | `node scripts/seed-admin.js --email you@x.com --password '...'` |
| View logs | `pm2 logs filemanager` |
| Restart | `pm2 reload filemanager --update-env` |
| Health | `curl https://<domain>/api/health` |

---

## 11. API reference

```bash
# Upload a file (returns id + full details)
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

**Download routes:** `/p/:token` (public) · `/t/:token` (temporary) · `/d/:token` (private —
requires `Authorization: Bearer <jwt>`).

---

## 12. Security

- All queries scoped by `vendorId` — **cross-tenant access blocked**.
- **Argon2id** password hashing.
- API keys: only the **SHA-256 hash** is stored; the plain key is shown once.
- Suspension enforced on upload + download + all three link types.
- Public tokens unguessable (≥ 24 random bytes).
- HTTPS-only secure cookies; security headers added by `middleware.ts`.
- **zod** validation on every route.
- **Audit log** on every state change.
- Mongo + MinIO bound to `127.0.0.1`; only `22 / 80 / 443` open via UFW.

CI gate: `.github/workflows/deploy.yml` runs `npm test` before any deploy. Failing tests block it.

---

## 13. License, copyright & trademarks

**Copyright (c) 2024–2026 BetaZen InfoTech. All rights reserved.**

Proprietary — internal SaaS. Source is provided for self-hosting and audit only. Commercial
redistribution, sublicensing, or operating a competing hosted service requires a separate written
agreement with BetaZen InfoTech. "BetaZen" and the BetaZen logo are trademarks of BetaZen InfoTech.

---

## 14. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Certbot fails | DNS A record isn't pointing at the VPS. Fix DNS → `sudo certbot --nginx -d <domain>`. Or install with `--skip-ssl`. |
| App not responding | `pm2 logs filemanager` · `pm2 reload filemanager --update-env` |
| Health not green | `curl http://127.0.0.1:3000/api/health` · `docker compose ps` (Mongo/MinIO healthy?) |
| Lost admin password | Re-seed: `cd /var/www/app && node scripts/seed-admin.js --email you@x.com --password '...'` |
| Private clone fails | Check token scope / deploy key (see §5.2, §5.3) |
| Prompts hang on pipe-install | Use `sudo bash <(curl ...)`; the installer reads prompts from `/dev/tty` |
| Full setup log | `/var/log/fms-setup.log` · install report at `/root/file-manager-install-report.txt` |

---

<div align="center">

Built by **[BetaZen InfoTech](https://betazeninfotech.com)** · © 2024–2026

</div>
