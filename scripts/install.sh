#!/usr/bin/env bash
# ============================================================
# File Manager SaaS — one-shot installer for blank Ubuntu VPS
# Usage: bash scripts/install.sh <REPO_URL> [TARGET_DIR]
# Works for both public and private repos (deploy key already set up).
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"
TARGET_DIR="${2:-/var/www/app}"
NODE_MAJOR="20"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: bash install.sh <REPO_URL> [TARGET_DIR]"
  exit 1
fi

log() { printf "\n\033[1;36m>> %s\033[0m\n" "$*"; }

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required."
  exit 1
fi

log "Updating apt and installing base packages"
sudo apt update
sudo apt install -y curl git nginx ca-certificates ufw fail2ban

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  log "Installing PM2"
  sudo npm i -g pm2
fi

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker + compose plugin"
  sudo apt install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
fi

if ! command -v certbot >/dev/null 2>&1; then
  log "Installing Certbot"
  sudo apt install -y certbot python3-certbot-nginx
fi

log "Configuring UFW firewall (SSH + 80 + 443 only)"
sudo ufw --force enable >/dev/null 2>&1 || true
sudo ufw allow OpenSSH || true
sudo ufw allow 80 || true
sudo ufw allow 443 || true

log "Setting up infra directory (~/infra/docker-compose.yml)"
mkdir -p "$HOME/infra"
if [[ ! -f "$HOME/infra/docker-compose.yml" ]]; then
  cp "$(dirname "$0")/../infra/docker-compose.yml" "$HOME/infra/docker-compose.yml" 2>/dev/null || \
    cp "$(dirname "$0")/../docker-compose.yml" "$HOME/infra/docker-compose.yml" 2>/dev/null || \
    echo "(skipping docker-compose copy — file will be in repo)"
fi

log "Cloning $REPO_URL into $TARGET_DIR"
sudo mkdir -p "$(dirname "$TARGET_DIR")"
sudo chown -R "$USER" "$(dirname "$TARGET_DIR")"
if [[ -d "$TARGET_DIR/.git" ]]; then
  (cd "$TARGET_DIR" && git pull)
else
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo
  echo ">> .env has been created from .env.example."
  echo ">> Open it and fill in the real values, then press Enter to continue:"
  read -r _
fi

log "Bringing up infra services (Mongo + MinIO) on localhost"
if [[ -f "$TARGET_DIR/docker-compose.yml" ]]; then
  sudo docker compose -f "$TARGET_DIR/docker-compose.yml" up -d
else
  sudo docker compose -f "$HOME/infra/docker-compose.yml" up -d
fi

log "Installing dependencies + building"
npm ci
npm run build

log "Seeding first super_admin (skip if already exists)"
node scripts/seed-admin.js || true

log "Starting under PM2"
pm2 startOrReload ecosystem.config.js || pm2 start npm --name filemanager -- start
pm2 save

log "PM2 startup hook (run the command it prints if it asks you to)"
pm2 startup || true

log "Done."
echo
echo "Next:"
echo "  1) Configure /etc/nginx/sites-available/filemanager   (template in nginx/filemanager.conf)"
echo "  2) sudo certbot --nginx -d files.yourdomain.com"
echo "  3) Visit https://files.yourdomain.com/login"
