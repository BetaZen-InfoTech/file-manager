#!/usr/bin/env bash
# =============================================================================
# fms-ssl-helper — privileged, NARROW helper for panel-driven domain/SSL ops.
#
# Installed to /usr/local/sbin/fms-ssl-helper by setup.sh and granted to the
# app user via a restricted sudoers entry (or run directly when the app is
# root). It exposes ONLY the fixed subcommands below and validates every
# argument with a strict regex, so the web panel can never inject a shell
# command or operate on an arbitrary path.
#
#   fms-ssl-helper status   <domain>
#   fms-ssl-helper issue     <domain> <email>
#   fms-ssl-helper force-https <domain>
#   fms-ssl-helper set-vhost <domain>
#
# `status` prints a single JSON line; the others print a JSON {ok,message}.
# =============================================================================
set -uo pipefail

APP_DIR="${APP_DIR:-/var/www/app}"
NGX_AVAIL="/etc/nginx/sites-available/filemanager"
NGX_ENABLED="/etc/nginx/sites-enabled/filemanager"
TEMPLATE="$APP_DIR/nginx/filemanager.conf"

json_err() { printf '{"ok":false,"message":%s}\n' "$(printf '%s' "$1" | sed 's/"/\\"/g; s/^/"/; s/$/"/')"; exit 1; }
json_ok()  { printf '{"ok":true,"message":%s}\n'  "$(printf '%s' "$1" | sed 's/"/\\"/g; s/^/"/; s/$/"/')"; }

valid_domain() {
  local d="$1"
  [[ ${#d} -le 253 ]] || return 1
  [[ "$d" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]
}
valid_email() {
  local e="$1"
  [[ ${#e} -le 254 ]] || return 1
  [[ "$e" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

require_root() { [[ "$(id -u)" -eq 0 ]] || json_err "helper must run as root"; }

cmd="${1:-}"; shift || true

case "$cmd" in
  status)
    domain="${1:-}"
    valid_domain "$domain" || json_err "invalid domain"
    cert_present=false; cert_expiry=""; redirect=false; nginx_ok=false
    if [[ -f "/etc/letsencrypt/live/$domain/fullchain.pem" ]]; then
      cert_present=true
      cert_expiry="$(openssl x509 -enddate -noout -in "/etc/letsencrypt/live/$domain/fullchain.pem" 2>/dev/null | cut -d= -f2 || true)"
    fi
    if [[ -f "$NGX_AVAIL" ]] && grep -Eq 'return 301 https|^\s*if .*scheme.*http' "$NGX_AVAIL" 2>/dev/null; then
      redirect=true
    fi
    nginx -t >/dev/null 2>&1 && nginx_ok=true
    printf '{"domain":"%s","certPresent":%s,"certExpiry":"%s","redirectEnabled":%s,"nginxOk":%s}\n' \
      "$domain" "$cert_present" "$cert_expiry" "$redirect" "$nginx_ok"
    ;;

  issue)
    require_root
    domain="${1:-}"; email="${2:-}"
    valid_domain "$domain" || json_err "invalid domain"
    valid_email  "$email"  || json_err "invalid email"
    command -v certbot >/dev/null 2>&1 || json_err "certbot not installed"
    if certbot --nginx -d "$domain" --non-interactive --agree-tos --email "$email" --redirect >/tmp/fms-certbot.log 2>&1; then
      json_ok "SSL active for $domain"
    else
      json_err "certbot failed (check DNS for $domain); see /tmp/fms-certbot.log"
    fi
    ;;

  force-https)
    require_root
    domain="${1:-}"
    valid_domain "$domain" || json_err "invalid domain"
    [[ -d "/etc/letsencrypt/live/$domain" ]] || json_err "no certificate for $domain — issue SSL first"
    command -v certbot >/dev/null 2>&1 || json_err "certbot not installed"
    if certbot --nginx -d "$domain" --redirect --non-interactive >/tmp/fms-certbot.log 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || true
      json_ok "HTTP->HTTPS redirect enforced for $domain"
    else
      json_err "could not apply redirect; see /tmp/fms-certbot.log"
    fi
    ;;

  set-vhost)
    require_root
    domain="${1:-}"
    valid_domain "$domain" || json_err "invalid domain"
    [[ -f "$TEMPLATE" ]] || json_err "vhost template missing at $TEMPLATE"
    sed "s/files\.yourdomain\.com/$domain/g" "$TEMPLATE" > "$NGX_AVAIL"
    ln -sf "$NGX_AVAIL" "$NGX_ENABLED"
    rm -f /etc/nginx/sites-enabled/default
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx >/dev/null 2>&1 || true
      json_ok "nginx vhost set to $domain (issue SSL next)"
    else
      json_err "nginx config test failed for $domain"
    fi
    ;;

  *)
    json_err "unknown command (use: status|issue|force-https|set-vhost)"
    ;;
esac
