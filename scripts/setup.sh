#!/usr/bin/env bash
# =============================================================================
# File Manager SaaS — single-file installer for Ubuntu 22.04 / 24.04
#
# This ONE script does everything: dependencies, repo clone (or update),
# .env generation with random secrets, Mongo + MinIO via docker compose,
# build, super_admin seed, Nginx vhost, Let's Encrypt SSL, cron jobs,
# PM2 boot-time autostart, and a post-install health check.
#
# Run as root (or with sudo) on a blank or existing VPS.
#
# Quick non-interactive usage:
#   sudo bash setup.sh \
#     --domain cdn.betazeninfotech.com \
#     --email you@betazeninfotech.com \
#     --repo git@github.com:BetaZen-InfoTech/file-manager.git \
#     --admin-email admin@betazeninfotech.com \
#     --admin-pass 'StrongPassword!'
#
# Run interactively (no flags): the script will prompt for everything it needs.
#
# Idempotent — re-run anytime; safe steps are skipped if already done. To do a
# fresh install (wipes the DB volume!), pass --reset.
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# ============================================================================
# BUILT-IN DEFAULTS — edit this block to rebrand/preconfigure the installer.
# Everything below can still be overridden by a CLI flag or an interactive
# prompt; these are just the values used when nothing else is supplied.
# ============================================================================
DEFAULT_DOMAIN="cdn.betazeninfotech.com"   # used for Nginx vhost + SSL cert
DEFAULT_ADMIN_EMAIL=""                      # blank → admin@<domain>
DEFAULT_ADMIN_PASS=""                       # blank → auto-generated 16-char random (shown in report)
DEFAULT_SSL_EMAIL=""                        # blank → falls back to the admin email
DEFAULT_REPO="https://github.com/BetaZen-InfoTech/file-manager.git"
DEFAULT_BRANCH="main"
DEFAULT_APP_DIR="/var/www/app"

# ---------- runtime values (populated from flags / prompts / defaults) ----- #
DOMAIN=""
EMAIL=""
REPO="$DEFAULT_REPO"
BRANCH="$DEFAULT_BRANCH"
APP_DIR="$DEFAULT_APP_DIR"
SKIP_SSL=0
SKIP_DNS_CHECK=0
ADMIN_EMAIL=""
ADMIN_PASS=""
RESET=0
INTERACTIVE=0
VERBOSE=0

# ---------- output helpers ------------------------------------------------- #
RED=$'\033[1;31m'
GREEN=$'\033[1;32m'
YELLOW=$'\033[1;33m'
BLUE=$'\033[1;36m'
DIM=$'\033[2m'
RESET=$'\033[0m'

step()  { printf "\n${BLUE}== %s ==${RESET}\n" "$*"; }
ok()    { printf "${GREEN}  ✓ %s${RESET}\n" "$*"; }
warn()  { printf "${YELLOW}  ! %s${RESET}\n" "$*"; }
err()   { printf "${RED}  ✗ %s${RESET}\n" "$*" >&2; }
info()  { printf "${DIM}    %s${RESET}\n" "$*"; }
hr()    { printf "${DIM}%s${RESET}\n" "----------------------------------------------------------------"; }

trap_err() {
  local exit_code=$?
  err "Setup failed at line $1 (exit $exit_code)."
  err "Re-run with VERBOSE=1 for full trace. Logs at /var/log/fms-setup.log."
  exit "$exit_code"
}
trap 'trap_err $LINENO' ERR

# Log everything to /var/log/fms-setup.log too
exec > >(tee -a /var/log/fms-setup.log) 2>&1

# ---------- arg parse ------------------------------------------------------ #
print_help() {
  sed -n '2,30p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)            DOMAIN="$2"; shift 2;;
    --email)             EMAIL="$2"; shift 2;;
    --repo)              REPO="$2"; shift 2;;
    --branch)            BRANCH="$2"; shift 2;;
    --dir)               APP_DIR="$2"; shift 2;;
    --skip-ssl)          SKIP_SSL=1; shift;;
    --skip-dns-check)    SKIP_DNS_CHECK=1; shift;;
    --admin-email)       ADMIN_EMAIL="$2"; shift 2;;
    --admin-pass)        ADMIN_PASS="$2"; shift 2;;
    --reset)             RESET=1; shift;;
    --interactive|-i)    INTERACTIVE=1; shift;;
    --verbose|-v)        VERBOSE=1; shift;;
    --help|-h)           print_help; exit 0;;
    *) err "unknown flag: $1"; print_help; exit 2;;
  esac
done
[[ "$VERBOSE" -eq 1 ]] && set -x

# ---------- privilege check ------------------------------------------------ #
if [[ "$(id -u)" -ne 0 ]]; then
  err "Run as root (or with sudo)."
  exit 1
fi

# ---------- OS check ------------------------------------------------------- #
if ! grep -qiE 'ubuntu' /etc/os-release 2>/dev/null; then
  warn "This installer is tested on Ubuntu 22.04 / 24.04. Proceeding anyway."
fi

# ---------- interactive prompts ------------------------------------------- #
# Reads keyboard input from the controlling terminal (/dev/tty) rather than
# stdin, so prompts still work when this script is piped in via
# `curl ... | sudo bash` or `sudo bash <(curl ...)`.
prompt() {
  local var="$1" question="$2" default="${3:-}" silent="${4:-0}"
  local val=""
  if [[ -n "${!var:-}" ]]; then return; fi
  if [[ ! -r /dev/tty ]]; then
    err "No terminal available for interactive prompts."
    err "Pipe-installs can't prompt — pass flags instead, e.g.:"
    err "  ... | sudo bash -s -- --domain files.example.com --email you@example.com"
    exit 2
  fi
  if [[ -n "$default" ]]; then
    read -r -p "  ${question} [${default}]: " val </dev/tty
    val="${val:-$default}"
  elif [[ "$silent" == "1" ]]; then
    read -r -s -p "  ${question}: " val </dev/tty; echo
  else
    read -r -p "  ${question}: " val </dev/tty
  fi
  printf -v "$var" '%s' "$val"
}

if [[ -z "$DOMAIN" && "$INTERACTIVE" -eq 0 ]]; then
  INTERACTIVE=1
fi

if [[ "$INTERACTIVE" -eq 1 ]]; then
  step "Interactive setup — answer a few questions"
  prompt DOMAIN       "Domain" "$DEFAULT_DOMAIN"
  prompt EMAIL        "Email for Let's Encrypt SSL (blank = admin@$DOMAIN)" "${DEFAULT_SSL_EMAIL:-${DEFAULT_ADMIN_EMAIL:-admin@${DOMAIN:-$DEFAULT_DOMAIN}}}"
  prompt REPO         "Git repo URL (SSH for private, HTTPS for public)" "$REPO"
  prompt BRANCH       "Branch to deploy" "$BRANCH"
  prompt APP_DIR      "Install dir" "$APP_DIR"
  prompt ADMIN_EMAIL  "First super_admin email" "${DEFAULT_ADMIN_EMAIL:-admin@${DOMAIN:-$DEFAULT_DOMAIN}}"
  prompt ADMIN_PASS   "First super_admin password (blank = auto-generate)" "" 1
  echo
fi

# Apply built-in defaults when nothing was supplied (flag or prompt left blank).
#   - domain      → DEFAULT_DOMAIN
#   - admin email → DEFAULT_ADMIN_EMAIL, else admin@<domain>
#   - SSL email   → DEFAULT_SSL_EMAIL, else the admin email
#   - admin pass  → DEFAULT_ADMIN_PASS, else auto-generated later (step 10)
DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
ADMIN_EMAIL="${ADMIN_EMAIL:-${DEFAULT_ADMIN_EMAIL:-admin@$DOMAIN}}"
EMAIL="${EMAIL:-${DEFAULT_SSL_EMAIL:-$ADMIN_EMAIL}}"
ADMIN_PASS="${ADMIN_PASS:-$DEFAULT_ADMIN_PASS}"

if [[ -n "$ADMIN_PASS" && ${#ADMIN_PASS} -lt 8 ]]; then
  err "admin password must be at least 8 characters."
  exit 2
fi

# ---------- DNS pre-check -------------------------------------------------- #
if [[ "$SKIP_DNS_CHECK" -eq 0 && "$SKIP_SSL" -eq 0 ]]; then
  step "Checking DNS for $DOMAIN"
  PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  RESOLVED="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '/STREAM/{print $1; exit}')"
  if [[ -n "$PUBLIC_IP" && -n "$RESOLVED" ]]; then
    if [[ "$RESOLVED" == "$PUBLIC_IP" ]]; then
      ok "DNS: $DOMAIN → $RESOLVED (matches VPS IP)"
    else
      warn "DNS: $DOMAIN resolves to $RESOLVED but VPS IP is $PUBLIC_IP."
      warn "Certbot will fail. Update your DNS A record, then re-run, OR pass --skip-ssl."
      if [[ -r /dev/tty ]]; then
        read -r -p "  Continue anyway? (y/N) " ans </dev/tty
      else
        ans="n"; warn "No terminal to confirm — aborting. Pass --skip-dns-check to override."
      fi
      [[ "${ans,,}" != "y" ]] && exit 1
    fi
  else
    warn "Couldn't determine public IP / DNS — skipping check."
  fi
fi

# ============================================================================
# 1. Base packages
# ============================================================================
step "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq \
  curl git nginx ufw fail2ban ca-certificates gnupg \
  openssl jq lsb-release rsync
ok "apt + base packages"

# ============================================================================
# 2. Node.js 20 + PM2
# ============================================================================
NODE_MAJOR=20
if ! command -v node >/dev/null 2>&1 || ! node -v 2>/dev/null | grep -qE "^v(2[0-9]|[3-9][0-9])"; then
  step "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  step "Installing PM2"
  npm i -g pm2 --silent
fi
ok "PM2 $(pm2 -v)"

# ============================================================================
# 3. Docker + compose plugin
# ============================================================================
if ! command -v docker >/dev/null 2>&1; then
  step "Installing Docker + compose plugin"
  apt-get install -y -qq docker.io docker-compose-v2
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
ok "Docker $(docker --version | cut -d, -f1)"

# ============================================================================
# 4. Certbot
# ============================================================================
if [[ "$SKIP_SSL" -eq 0 ]] && ! command -v certbot >/dev/null 2>&1; then
  step "Installing Certbot"
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ============================================================================
# 5. UFW firewall
# ============================================================================
step "Configuring UFW (SSH + 80 + 443 only)"
ufw --force enable >/dev/null 2>&1 || true
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 80 >/dev/null 2>&1 || true
ufw allow 443 >/dev/null 2>&1 || true
ok "Firewall: SSH + HTTP + HTTPS open; Mongo/MinIO bound to 127.0.0.1 (never exposed)"

# ============================================================================
# 6. Repo clone or update
# ============================================================================
step "Fetching repo $REPO ($BRANCH) → $APP_DIR"
mkdir -p "$(dirname "$APP_DIR")"

if [[ "$REPO" == git@* ]] && ! [[ -f /root/.ssh/known_hosts ]] || ! grep -q github.com /root/.ssh/known_hosts 2>/dev/null; then
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  ssh-keyscan -t ed25519 github.com 2>/dev/null >> /root/.ssh/known_hosts || true
fi

if [[ -d "$APP_DIR/.git" ]]; then
  info "Repo exists — pulling latest"
  git -C "$APP_DIR" fetch --all --quiet
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  if ! git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"; then
    err "Clone failed. If repo is private:"
    err "  1) Generate a deploy key: ssh-keygen -t ed25519 -f /root/.ssh/deploy_key -N ''"
    err "  2) Add /root/.ssh/deploy_key.pub to: <repo>/settings/keys"
    err "  3) Configure SSH:"
    err "       cat >> /root/.ssh/config <<EOF"
    err "       Host github.com"
    err "         IdentityFile /root/.ssh/deploy_key"
    err "         IdentitiesOnly yes"
    err "       EOF"
    err "  4) Re-run this script with: --repo git@github.com:OWNER/REPO.git"
    exit 1
  fi
fi
ok "Repo at HEAD $(git -C "$APP_DIR" rev-parse --short HEAD)"

cd "$APP_DIR"

# ============================================================================
# 7. .env (auto-generated)
# ============================================================================
ENV_FILE="$APP_DIR/.env"
gen_secret() { openssl rand -hex 32; }

if [[ ! -f "$ENV_FILE" || "$RESET" -eq 1 ]]; then
  [[ "$RESET" -eq 1 && -f "$ENV_FILE" ]] && { warn "--reset: backing up old .env to .env.bak.$(date +%s)"; mv "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"; }

  step "Generating $ENV_FILE with random secrets"
  JWT_SECRET="$(gen_secret)"
  SESSION_COOKIE_SECRET="$(gen_secret)"
  GITHUB_WEBHOOK_SECRET="$(gen_secret)"
  INTERNAL_CRON_SECRET="$(gen_secret)"
  MONGO_PASSWORD="$(openssl rand -hex 16)"
  S3_ACCESS_KEY="fms$(openssl rand -hex 4)"
  S3_SECRET_KEY="$(gen_secret)"

  cat > "$ENV_FILE" <<EOF
# Generated by setup.sh on $(date -u +%FT%TZ)
NODE_ENV=production
APP_URL=https://$DOMAIN
PORT=3000

JWT_SECRET=$JWT_SECRET
SESSION_COOKIE_SECRET=$SESSION_COOKIE_SECRET
SESSION_COOKIE_NAME=fms_session
SESSION_TTL_HOURS=12

MONGODB_URI=mongodb://fmsuser:$MONGO_PASSWORD@127.0.0.1:27017/filemanager?authSource=admin
MONGO_USER=fmsuser
MONGO_PASSWORD=$MONGO_PASSWORD

STORAGE_DRIVER=minio
S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=$S3_ACCESS_KEY
S3_SECRET_KEY=$S3_SECRET_KEY
S3_FORCE_PATH_STYLE=true
S3_USE_SSL=false
S3_DEFAULT_BUCKET=filemanager

PUBLIC_URL_BASE=https://$DOMAIN
PUBLIC_TOKEN_BYTES=24

GITHUB_WEBHOOK_SECRET=$GITHUB_WEBHOOK_SECRET
DEPLOY_BRANCH=$BRANCH
DEPLOY_SCRIPT=$APP_DIR/scripts/deploy.sh

MAX_UPLOAD_BYTES=524288000
REDIS_URL=
CLAMAV_HOST=
CLAMAV_PORT=3310

MAIL_DRIVER=noop
MAIL_HOST=
MAIL_PORT=587
MAIL_USER=
MAIL_PASS=
MAIL_FROM=File Manager <no-reply@$DOMAIN>

INTERNAL_CRON_SECRET=$INTERNAL_CRON_SECRET
RATE_LIMIT_PER_MIN=100
EOF
  chmod 600 "$ENV_FILE"
  ok "wrote $ENV_FILE (chmod 600, owner=root)"
else
  ok ".env exists — leaving it alone"
fi

# Export so subsequent steps have the values
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ============================================================================
# 8. Infra (Mongo + MinIO) via docker compose
# ============================================================================
step "Starting Mongo + MinIO via docker compose"
if [[ "$RESET" -eq 1 ]]; then
  warn "--reset: tearing down volumes too"
  docker compose -f "$APP_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
fi
docker compose -f "$APP_DIR/docker-compose.yml" up -d >/dev/null

# Wait for Mongo healthy (max ~60s)
info "Waiting for Mongo to accept connections..."
for i in $(seq 1 30); do
  if docker compose -f "$APP_DIR/docker-compose.yml" ps mongo 2>/dev/null | grep -q "healthy"; then
    ok "Mongo healthy"
    break
  fi
  if [[ $i -eq 30 ]]; then
    err "Mongo didn't become healthy in 60s. Check: docker compose logs mongo"
    exit 1
  fi
  sleep 2
done

# Wait for MinIO
info "Waiting for MinIO..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
    ok "MinIO healthy"
    break
  fi
  [[ $i -eq 30 ]] && { err "MinIO didn't start in 60s."; exit 1; }
  sleep 2
done

# ============================================================================
# 9. npm deps + tests + build
# ============================================================================
step "Installing npm dependencies (this is the long step — ~2-4 min)"
# Prefer the reproducible `npm ci`, but fall back to `npm install` when no
# package-lock.json is present (it isn't committed in this repo).
if [[ -f package-lock.json ]]; then
  npm ci --silent --no-audit --no-fund || npm install --silent --no-audit --no-fund
else
  npm install --silent --no-audit --no-fund
fi
ok "Dependencies installed"

step "Running core-logic tests (security verification)"
npm test
ok "Tests passed"

step "Building Next.js production bundle"
npm run build
ok "Build complete"

# ============================================================================
# 10. Seed first super_admin
# ============================================================================
# ADMIN_EMAIL always has a value (defaults to admin@<domain>). If no password
# was provided, generate a strong random one and surface it in the report.
ADMIN_PASS_GENERATED=0
if [[ -z "$ADMIN_PASS" ]]; then
  ADMIN_PASS="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
  ADMIN_PASS_GENERATED=1
  info "No admin password provided — generated a strong random one (shown at the end)."
fi

step "Seeding first super_admin ($ADMIN_EMAIL)"
if node scripts/seed-admin.js --email "$ADMIN_EMAIL" --password "$ADMIN_PASS" 2>&1 | tee /tmp/fms-seed.log | grep -q "already exists"; then
  ok "super_admin already exists — leaving its password unchanged"
  ADMIN_PASS_GENERATED=0   # account predates this run; the generated pass wasn't applied
else
  ok "super_admin created ($ADMIN_EMAIL)"
fi

# ============================================================================
# 11. PM2
# ============================================================================
step "Starting under PM2"
if pm2 jlist 2>/dev/null | grep -q '"name":"filemanager"'; then
  pm2 reload filemanager --update-env >/dev/null
else
  pm2 start ecosystem.config.js >/dev/null
fi
pm2 save >/dev/null

# Enable PM2 on boot (idempotent: re-running doesn't break)
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
systemctl enable pm2-root >/dev/null 2>&1 || true
ok "PM2 process up, boot-time autostart enabled"

# ============================================================================
# 11b. bcdnp admin console (global `bcdnp` command)
# ============================================================================
step "Installing bcdnp admin console"
if [[ -f "$APP_DIR/scripts/bcdnp.sh" ]]; then
  chmod +x "$APP_DIR/scripts/bcdnp.sh"
  # Wrapper so the command always knows where the app lives.
  cat > /usr/local/bin/bcdnp <<EOF
#!/usr/bin/env bash
export APP_DIR="$APP_DIR"
exec bash "$APP_DIR/scripts/bcdnp.sh" "\$@"
EOF
  chmod +x /usr/local/bin/bcdnp
  ok "Run 'sudo bcdnp' for the admin menu (domain, SSL, admin password, restart, heal…)"
else
  warn "scripts/bcdnp.sh not found — skipping bcdnp install"
fi

# ============================================================================
# 12. Nginx vhost
# ============================================================================
step "Configuring Nginx vhost for $DOMAIN"
NGX_AVAIL=/etc/nginx/sites-available/filemanager
NGX_ENABLED=/etc/nginx/sites-enabled/filemanager
sed "s/files\.yourdomain\.com/$DOMAIN/g" "$APP_DIR/nginx/filemanager.conf" > "$NGX_AVAIL"
ln -sf "$NGX_AVAIL" "$NGX_ENABLED"
rm -f /etc/nginx/sites-enabled/default
if nginx -t 2>&1 | grep -q "successful"; then
  systemctl reload nginx
  ok "Nginx vhost reloaded"
else
  err "Nginx config test failed"
  nginx -t
  exit 1
fi

# ============================================================================
# 13. Let's Encrypt SSL
# ============================================================================
if [[ "$SKIP_SSL" -eq 0 ]]; then
  if [[ -d "/etc/letsencrypt/live/$DOMAIN" ]]; then
    ok "SSL cert already exists for $DOMAIN — skipping"
  else
    step "Requesting Let's Encrypt SSL cert for $DOMAIN"
    if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect --quiet; then
      ok "SSL active. Auto-renewal handled by certbot.timer."
    else
      warn "Certbot failed. DNS may not resolve to this host yet."
      warn "Re-run later: sudo certbot --nginx -d $DOMAIN"
    fi
  fi
else
  warn "--skip-ssl: SSL not configured. Re-run later: sudo certbot --nginx -d $DOMAIN"
fi

# ============================================================================
# 14. Cron jobs (INLINED — no separate setup-cron.sh needed)
# ============================================================================
step "Installing cron jobs"
MARKER="# >>> filemanager cron >>>"
ENDM="# <<< filemanager cron <<<"
TMP="$(mktemp)"
crontab -l 2>/dev/null | sed "/$MARKER/,/$ENDM/d" > "$TMP" || true
cat >> "$TMP" <<EOF
$MARKER
# Expire links every 5 minutes
*/5 * * * * curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:${PORT:-3000}/api/internal/cron/expire-urls >/dev/null
# Purge trash (>30 days) daily at 03:00 UTC
0 3 * * * curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:${PORT:-3000}/api/internal/cron/purge-trash >/dev/null
# Recount vendor usage weekly (Sunday 04:00 UTC)
0 4 * * 0 curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:${PORT:-3000}/api/internal/cron/recount-usage >/dev/null
# Orphan upload sweep weekly (Sunday 05:00 UTC)
0 5 * * 0 curl -fsS -H "x-cron-secret: $INTERNAL_CRON_SECRET" http://127.0.0.1:${PORT:-3000}/api/internal/cron/orphan-sweep >/dev/null
# Daily backup at 02:30 UTC
30 2 * * * APP_DIR=$APP_DIR $APP_DIR/scripts/backup.sh >> /var/log/fms-backup.log 2>&1
$ENDM
EOF
crontab "$TMP"
rm -f "$TMP"
ok "Cron jobs installed"

# ============================================================================
# 15. Health check
# ============================================================================
step "Post-install health check"
info "Waiting for /api/health to report green..."
HEALTH_OK=0
for i in $(seq 1 15); do
  RES="$(curl -fsS --max-time 5 "http://127.0.0.1:${PORT:-3000}/api/health" 2>/dev/null || true)"
  if echo "$RES" | grep -q '"ok":true'; then
    HEALTH_OK=1
    ok "Health: $(echo "$RES" | head -c 120)…"
    break
  fi
  sleep 2
done
[[ "$HEALTH_OK" -eq 0 ]] && warn "/api/health not green yet — check: pm2 logs filemanager"

# ============================================================================
# 16. Final report
# ============================================================================
REPORT_FILE="/root/file-manager-install-report.txt"
{
  echo "File Manager SaaS — install report"
  echo "Generated: $(date -u +%FT%TZ)"
  echo "Host:      $(hostname)  ($(hostname -I | awk '{print $1}'))"
  echo "App dir:   $APP_DIR"
  echo "Git HEAD:  $(git -C "$APP_DIR" rev-parse --short HEAD)"
  echo "Branch:    $BRANCH"
  echo "URL:       https://$DOMAIN/login"
  echo "Health:    https://$DOMAIN/api/health"
  echo "Docs:      https://$DOMAIN/docs"
  echo
  echo "--- Super admin login ---"
  echo "Email:     $ADMIN_EMAIL"
  if [[ "$ADMIN_PASS_GENERATED" -eq 1 ]]; then
    echo "Password:  $ADMIN_PASS   (auto-generated — change after first login)"
  else
    echo "Password:  (as provided at install time)"
  fi
  echo
  echo "--- Secrets (also in $ENV_FILE) ---"
  echo "GITHUB_WEBHOOK_SECRET=$(grep '^GITHUB_WEBHOOK_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  echo "S3_ACCESS_KEY=$(grep '^S3_ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  echo "S3_SECRET_KEY=$(grep '^S3_SECRET_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  echo "INTERNAL_CRON_SECRET=$(grep '^INTERNAL_CRON_SECRET=' "$ENV_FILE" | cut -d= -f2-)"
  echo
  echo "--- GitHub deploy webhook ---"
  echo "URL:    https://$DOMAIN/api/v1/deploy/github"
  echo "Secret: see GITHUB_WEBHOOK_SECRET above"
  echo "Events: push only"
  echo
  echo "--- Commands ---"
  echo "Admin console:      sudo bcdnp           (domain, SSL, admin pw, restart, heal…)"
  echo "Update from main:   cd $APP_DIR && bash scripts/update.sh"
  echo "Logs:               pm2 logs filemanager"
  echo "Restart:            pm2 reload filemanager --update-env"
  echo "Health:             curl https://$DOMAIN/api/health"
  echo "Maintenance mode:   POST /api/v1/admin/maintenance  {enabled:true}"
} > "$REPORT_FILE"
chmod 600 "$REPORT_FILE"

echo
hr
printf "${GREEN}  File Manager SaaS is up at https://%s/login${RESET}\n" "$DOMAIN"
hr
printf "  Admin email:  ${GREEN}%s${RESET}\n" "$ADMIN_EMAIL"
if [[ "$ADMIN_PASS_GENERATED" -eq 1 ]]; then
  printf "  Admin pass:   ${GREEN}%s${RESET}  ${DIM}(auto-generated — change it)${RESET}\n" "$ADMIN_PASS"
fi
echo  "  Install dir:  $APP_DIR"
echo  "  Report saved: $REPORT_FILE  (chmod 600)"
echo
echo  "  Next steps:"
echo  "    1. Open https://$DOMAIN/login and sign in."
echo  "    2. Add a GitHub webhook:"
echo  "         URL:    https://$DOMAIN/api/v1/deploy/github"
echo  "         Secret: (see $REPORT_FILE)"
echo  "       Then 'git push origin main' will auto-deploy."
echo  "    3. (Optional) Configure mail in $ENV_FILE (MAIL_DRIVER=smtp + creds)"
echo  "       then: pm2 reload filemanager --update-env"
echo
echo  "  Update later:  cd $APP_DIR && bash scripts/update.sh"
echo
