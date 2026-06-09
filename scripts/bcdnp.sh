#!/usr/bin/env bash
# =============================================================================
# bcdnp — BetaZen CDN Panel admin console
#
# An interactive, numbered menu for the most common server-side admin tasks:
# domain setup, SSL, force-HTTPS, super-admin email/password, Mongo reload,
# restart panel/nginx, auto-heal, update, backup, logs, maintenance mode.
#
# Installed to /usr/local/bin/bcdnp by scripts/setup.sh. Run as root:
#   sudo bcdnp                 # interactive menu
#   sudo bcdnp <number|name>   # jump straight to one action (e.g. `bcdnp restart`)
# =============================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/var/www/app}"
PM2_APP="filemanager"
ENV_FILE="$APP_DIR/.env"

# ---------- colours -------------------------------------------------------- #
RED=$'\033[1;31m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'
BLUE=$'\033[1;36m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; NC=$'\033[0m'
ok()   { printf "${GREEN}  ✓ %s${NC}\n" "$*"; }
warn() { printf "${YELLOW}  ! %s${NC}\n" "$*"; }
err()  { printf "${RED}  ✗ %s${NC}\n" "$*" >&2; }
info() { printf "${DIM}    %s${NC}\n" "$*"; }
hr()   { printf "${DIM}----------------------------------------------------------------${NC}\n"; }

need_root() {
  if [[ "$(id -u)" -ne 0 ]]; then err "Run as root (sudo bcdnp)."; exit 1; fi
}

# ---------- helpers -------------------------------------------------------- #
env_get() { [[ -f "$ENV_FILE" ]] && grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

env_set() {  # env_set KEY VALUE  (in-place, create if missing)
  local key="$1" val="$2"
  touch "$ENV_FILE"
  if grep -qE "^$key=" "$ENV_FILE"; then
    # Use awk, NOT sed: the value (e.g. a Mongo URI with //, &, ?, = and a
    # password full of specials) must be inserted verbatim — sed would
    # re-interpret &, /, \ and back-references and corrupt it.
    awk -v k="$key" -v v="$val" \
      '$0 ~ "^" k "=" {print k"="v; done=1; next} {print} END{if(!done) print k"="v}' \
      "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

current_domain() {
  local url; url="$(env_get APP_URL)"
  url="${url#http://}"; url="${url#https://}"; url="${url%%/*}"
  echo "${url:-cdn.betazeninfotech.com}"
}

public_ip() {
  curl -fsS --max-time 4 https://api.ipify.org 2>/dev/null \
    || curl -fsS --max-time 4 https://ifconfig.me 2>/dev/null \
    || hostname -I 2>/dev/null | awk '{print $1}'
}

ask() { local q="$1" def="${2:-}" ans; if [[ -n "$def" ]]; then read -r -p "  $q [$def]: " ans </dev/tty; echo "${ans:-$def}"; else read -r -p "  $q: " ans </dev/tty; echo "$ans"; fi; }
ask_secret() { local q="$1" ans; read -r -s -p "  $q: " ans </dev/tty; echo >&2; echo "$ans"; }
confirm() { local ans; read -r -p "  $1 (y/N) " ans </dev/tty; [[ "${ans,,}" == "y" ]]; }
pause()   { read -r -p "  ↵ Enter to continue… " _ </dev/tty; }

# ============================================================================
# Actions
# ============================================================================
act_open_panel() {       # 1
  local d ip; d="$(current_domain)"; ip="$(public_ip)"
  hr
  printf "  ${BOLD}Panel URL:${NC}  ${GREEN}https://%s/login${NC}\n" "$d"
  printf "  ${BOLD}By IP:${NC}      http://%s/login   ${DIM}(works once nginx is up)${NC}\n" "$ip"
  printf "  ${BOLD}Health:${NC}     https://%s/api/health\n" "$d"
  printf "  ${BOLD}Server IP:${NC}  %s\n" "$ip"
  hr
}

act_domain_setup() {     # 2
  local old new ip; old="$(current_domain)"; ip="$(public_ip)"
  new="$(ask "New domain (FQDN)" "$old")"
  [[ -z "$new" || "$new" == "$old" ]] && { warn "No change."; return; }
  info "Make sure an A record for $new points to $ip before issuing SSL."
  confirm "Switch domain $old -> $new?" || { warn "Cancelled."; return; }

  env_set APP_URL "https://$new"
  env_set PUBLIC_URL_BASE "https://$new"
  ok ".env updated (APP_URL, PUBLIC_URL_BASE)"

  # Rebuild nginx vhost from the repo template
  local avail=/etc/nginx/sites-available/filemanager enabled=/etc/nginx/sites-enabled/filemanager
  if [[ -f "$APP_DIR/nginx/filemanager.conf" ]]; then
    sed "s/files\.yourdomain\.com/$new/g" "$APP_DIR/nginx/filemanager.conf" > "$avail"
    ln -sf "$avail" "$enabled"; rm -f /etc/nginx/sites-enabled/default
    if nginx -t 2>&1 | grep -q successful; then systemctl reload nginx; ok "Nginx vhost rebuilt for $new"; else err "nginx -t failed"; nginx -t; return; fi
  fi
  pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 && ok "Panel reloaded with new env"
  if confirm "Issue/redirect SSL for $new now?"; then act_ssl_issue "$new"; fi
}

act_ssl_issue() {        # 3
  command -v certbot >/dev/null || { err "certbot not installed."; return; }
  local d="${1:-$(current_domain)}" email
  email="$(ask "Email for Let's Encrypt" "admin@$d")"
  if certbot --nginx -d "$d" --non-interactive --agree-tos --email "$email" --redirect; then
    ok "SSL active for $d (auto-renew via certbot.timer)"
  else
    err "Certbot failed — check DNS for $d, then retry."
  fi
}

act_force_https() {      # 4
  local d; d="$(current_domain)"
  if [[ ! -d "/etc/letsencrypt/live/$d" ]]; then
    warn "No SSL cert for $d yet — issue SSL first (option 3)."; return
  fi
  command -v certbot >/dev/null || { err "certbot not installed."; return; }
  if certbot --nginx -d "$d" --redirect --non-interactive --agree-tos --reinstall 2>/dev/null \
     || certbot --nginx -d "$d" --redirect --non-interactive 2>/dev/null; then
    systemctl reload nginx
    ok "HTTP → HTTPS redirect enforced for $d"
  else
    err "Could not apply redirect via certbot."
  fi
}

act_admin_email() {      # 5
  node "$APP_DIR/scripts/admin-tool.js" list 2>/dev/null
  local cur new; cur="$(ask "Current super_admin email")"; new="$(ask "New super_admin email")"
  [[ -z "$cur" || -z "$new" ]] && { warn "Cancelled."; return; }
  ( cd "$APP_DIR" && node scripts/admin-tool.js set-email --current "$cur" --new "$new" )
}

act_admin_password() {   # 6
  node "$APP_DIR/scripts/admin-tool.js" list 2>/dev/null
  local email pw pw2; email="$(ask "super_admin email to update")"
  pw="$(ask_secret "New password (>= 8 chars)")"; pw2="$(ask_secret "Confirm password")"
  [[ "$pw" != "$pw2" ]] && { err "Passwords do not match."; return; }
  ( cd "$APP_DIR" && node scripts/admin-tool.js set-password --email "$email" --password "$pw" )
}

# Mask the password in a mongodb URI for display.
mask_uri() { printf '%s' "$1" | sed -E 's#(mongodb(\+srv)?://[^:/@]+:)[^@]*@#\1***@#'; }

act_mongo_update() {     # 7
  local cur new test_out
  cur="$(env_get MONGODB_URI)"
  hr
  info "Current: $(mask_uri "$cur")"
  hr
  echo "  1) Update the MongoDB URI (test, then apply + reload)"
  echo "  2) Just test + reload the current URI"
  local choice; choice="$(ask "Choose" "1")"

  if [[ "$choice" == "2" ]]; then
    info "Testing current connection…"
    if ( cd "$APP_DIR" && node scripts/admin-tool.js ping ); then
      pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 && ok "Panel reloaded with current .env Mongo settings"
    else
      err "Mongo connection failed — fix MONGODB_URI (option 1), then retry."
    fi
    return
  fi

  info "Tip: for Atlas/managed Mongo, include a db name (/filemanager) and percent-encode"
  info "password specials (@ -> %40). Allowlist this server's IP in the provider too."
  new="$(ask "New MONGODB_URI" "$cur")"
  [[ -z "$new" ]] && { warn "Cancelled."; return; }
  if [[ "$new" != mongodb://* && "$new" != mongodb+srv://* ]]; then
    err "URI must start with mongodb:// or mongodb+srv://"; return
  fi
  # Require a database name in the path — a path-less URI silently uses "test".
  local db_seg="${new#mongodb*://*/}"; db_seg="${db_seg%%[?#]*}"
  if [[ "$db_seg" == "$new" || -z "$db_seg" ]]; then
    err "URI must include a database name in the path (e.g. .../filemanager)."; return
  fi
  [[ "$new" == "$cur" ]] && { warn "Unchanged."; return; }

  info "Testing new connection (up to 20s — remote clusters can be slow)…"
  if ! test_out="$( cd "$APP_DIR" && node scripts/admin-tool.js ping-uri --uri "$new" 2>/dev/null )"; then
    err "Could not connect with the new URI — NOT applied."
    info "Common causes: wrong creds, missing db name, or the provider's IP allowlist."
    info "Run with details: cd $APP_DIR && node scripts/admin-tool.js ping-uri --uri '<uri>'"
    return
  fi
  ok "Connection OK"
  local new_db_empty=0
  if printf '%s' "$test_out" | grep -q '"hasSuperAdmin":false'; then
    warn "The target database has NO super_admin user — you could be locked out of the panel."
    confirm "Apply anyway?" || { warn "Cancelled."; return; }
    new_db_empty=1
  fi

  # Back up .env, then write the new URI.
  cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)" 2>/dev/null || true
  env_set MONGODB_URI "$new"
  ok "Updated MONGODB_URI in .env (backup saved)"

  info "Reloading panel to apply…"
  pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 && ok "Panel reloaded" || warn "Reload failed — run option 8"

  # Offer to seed a super_admin when switching to a fresh/empty database.
  if [[ "$new_db_empty" == "1" ]] && confirm "Create a super_admin in the new database now?"; then
    act_seed_admin
  fi
  info "If the panel won't come back: sudo bcdnp restore-env (option 19)."
  sleep 2; act_health
}

# Seed the first super_admin (used after switching to an empty managed DB).
act_seed_admin() {
  local em pw pw2
  em="$(ask "New super_admin email")"; [[ -z "$em" ]] && { warn "Cancelled."; return; }
  pw="$(ask_secret "Password (>= 8 chars)")"; pw2="$(ask_secret "Confirm password")"
  [[ "$pw" != "$pw2" ]] && { err "Passwords do not match."; return; }
  [[ ${#pw} -lt 8 ]] && { err "Password must be at least 8 characters."; return; }
  ( cd "$APP_DIR" && node scripts/seed-admin.js --email "$em" --password "$pw" )
}

# Restore .env from a backup (recovery if a URI/domain change broke the panel).
act_env_restore() {
  hr; info "Available .env backups (newest first):"
  local backups; mapfile -t backups < <(ls -1t "$ENV_FILE".bak* 2>/dev/null)
  [[ ${#backups[@]} -eq 0 ]] && { warn "No .env backups found in $APP_DIR."; return; }
  local i=1; for b in "${backups[@]}"; do printf "  %d) %s\n" "$i" "$b"; ((i++)); done
  local pick idx; pick="$(ask "Restore which backup #" "1")"; idx=$((pick-1))
  [[ $idx -lt 0 || $idx -ge ${#backups[@]} ]] && { err "Invalid choice."; return; }
  cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)" 2>/dev/null || true
  cp -a "${backups[$idx]}" "$ENV_FILE" && ok "Restored ${backups[$idx]} -> $ENV_FILE"
  act_restart_panel; sleep 2; act_health
}

act_restart_panel() {    # 8
  if pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1; then ok "Panel reloaded (zero downtime)"
  elif ( cd "$APP_DIR" && pm2 start ecosystem.config.js >/dev/null 2>&1 ); then ok "Panel started"
  else err "PM2 reload failed — see: pm2 logs $PM2_APP"; fi
  pm2 save >/dev/null 2>&1 || true
}

act_restart_nginx() {    # 9
  if nginx -t 2>&1 | grep -q successful; then systemctl reload nginx && ok "Nginx reloaded"
  else err "nginx -t failed:"; nginx -t; fi
}

act_resolve() {          # 10
  hr; printf "  ${BOLD}Auto-heal sweep${NC}\n"; hr
  # 1) Infra
  if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
    docker compose -f "$APP_DIR/docker-compose.yml" up -d >/dev/null 2>&1 && ok "Mongo + MinIO up"
  fi
  # 2) Mongo / MinIO reachable
  ( cd "$APP_DIR" && node scripts/admin-tool.js ping >/dev/null 2>&1 ) && ok "Mongo reachable" || warn "Mongo not reachable"
  curl -fsS --max-time 3 http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && ok "MinIO healthy" || warn "MinIO not healthy"
  # 3) Panel
  pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 || ( cd "$APP_DIR" && pm2 start ecosystem.config.js >/dev/null 2>&1 )
  ok "Panel (re)started"
  # 4) Nginx
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx && ok "Nginx reloaded"; else warn "nginx -t failed (run option 9)"; fi
  # 5) Disk
  local use; use="$(df -h / | awk 'NR==2{print $5}')"
  printf "  ${DIM}Disk on /: %s used${NC}\n" "$use"
  [[ "${use%\%}" -ge 90 ]] 2>/dev/null && warn "Disk above 90% — clean up logs/backups."
  # 6) Health
  sleep 2; act_health
}

act_update() {           # 11
  [[ -x "$APP_DIR/scripts/update.sh" || -f "$APP_DIR/scripts/update.sh" ]] || { err "update.sh missing"; return; }
  ( cd "$APP_DIR" && bash scripts/update.sh )
}

act_health() {           # 12
  local d port res; d="$(current_domain)"; port="$(env_get PORT)"; port="${port:-3000}"
  res="$(curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
  if echo "$res" | grep -q '"ok":true'; then ok "Health green: $(echo "$res" | head -c 120)"
  else err "Health not green. Try option 10, or: pm2 logs $PM2_APP"; fi
}

act_logs() {             # 13
  info "Showing last 40 lines (Ctrl-C to exit a live tail)."
  pm2 logs "$PM2_APP" --lines 40 --nostream 2>/dev/null || pm2 logs "$PM2_APP"
}

act_maintenance() {      # 14
  local secret port on; secret="$(env_get INTERNAL_CRON_SECRET)"; port="$(env_get PORT)"; port="${port:-3000}"
  on="$(ask "Maintenance mode - enable? (true/false)" "true")"
  curl -fsS -X POST "http://127.0.0.1:$port/api/v1/admin/maintenance" \
    -H "Content-Type: application/json" -d "{\"enabled\":$on}" >/dev/null 2>&1 \
    && ok "Maintenance set to $on" \
    || warn "Could not toggle via API — set it from the Admin panel → Maintenance."
}

act_backup() {           # 15
  [[ -f "$APP_DIR/scripts/backup.sh" ]] || { err "backup.sh missing"; return; }
  ( cd "$APP_DIR" && APP_DIR="$APP_DIR" bash scripts/backup.sh ) && ok "Backup complete" || err "Backup failed"
}

act_report() {           # 16
  local f=/root/file-manager-install-report.txt
  [[ -f "$f" ]] && { hr; cat "$f"; hr; } || warn "No install report at $f"
}

act_edit_env() {         # 17
  "${EDITOR:-nano}" "$ENV_FILE"
  confirm "Reload panel to apply changes?" && act_restart_panel
}

act_status() {           # 18
  hr; pm2 status 2>/dev/null || warn "pm2 not running"
  hr; docker compose -f "$APP_DIR/docker-compose.yml" ps 2>/dev/null || true
  hr; systemctl is-active nginx >/dev/null 2>&1 && ok "nginx active" || warn "nginx inactive"
}

# ============================================================================
# Dispatch + menu
# ============================================================================
run_action() {
  case "$1" in
    1|open|panel)        act_open_panel;;
    2|domain)            act_domain_setup;;
    3|ssl)               act_ssl_issue;;
    4|https|force-https) act_force_https;;
    5|email)             act_admin_email;;
    6|password|passwd)   act_admin_password;;
    7|mongo|db|mongodb)   act_mongo_update;;
    8|restart|reload)    act_restart_panel;;
    9|nginx)             act_restart_nginx;;
    10|heal|resolve|fix) act_resolve;;
    11|update|upgrade)   act_update;;
    12|health)           act_health;;
    13|logs)             act_logs;;
    14|maintenance)      act_maintenance;;
    15|backup)           act_backup;;
    16|report|secrets)   act_report;;
    17|env|edit)         act_edit_env;;
    18|status)           act_status;;
    19|restore-env|rollback) act_env_restore;;
    20|seed|seed-admin|create-admin) act_seed_admin;;
    0|q|quit|exit)       return 9;;
    *) err "Unknown action: $1";;
  esac
}

menu() {
  local d ip; d="$(current_domain)"; ip="$(public_ip)"
  clear 2>/dev/null || true
  printf "${BLUE}${BOLD}  BetaZen CDN Panel — admin console (bcdnp)${NC}\n"
  hr
  printf "  Panel:  ${GREEN}https://%s/login${NC}\n" "$d"
  printf "  Server: %s   ·   App: %s   ·   pm2: %s\n" "$ip" "$APP_DIR" "$PM2_APP"
  hr
  cat <<'MENU'
   1) Open panel info (URL + IP)        10) Resolve server issues (auto-heal)
   2) Domain setup (change domain)      11) Update from GitHub (pull+build)
   3) Issue / renew SSL certificate     12) Health check
   4) Force HTTPS (redirect)            13) View panel logs
   5) Update super admin email          14) Toggle maintenance mode
   6) Update super admin password       15) Backup now
   7) Update MongoDB URI (test+apply)   16) Show install report / secrets
   8) Restart panel (pm2 reload)        17) Edit .env
   9) Restart nginx                     18) Status (pm2 + docker + nginx)
                                        19) Restore .env from backup
                                        20) Seed / create super_admin
                                         0) Quit
MENU
  hr
}

main() {
  need_root
  if [[ $# -gt 0 ]]; then run_action "$1"; exit $?; fi
  while true; do
    menu
    local choice; choice="$(ask "Choose")"
    echo
    run_action "$choice"; [[ $? -eq 9 ]] && { echo "  bye 👋"; break; }
    echo; pause
  done
}

main "$@"
