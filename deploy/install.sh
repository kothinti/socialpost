#!/usr/bin/env bash
# First-time install on an Ubuntu droplet (20.04+).
#
# 1. cp deploy/config.env.example deploy/config.env
# 2. Edit deploy/config.env (at minimum DOMAIN and APP_DIR)
# 3. ./deploy/install.sh
#
# Does not modify your existing static-site nginx configs.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$DEPLOY_DIR/lib.sh"

load_config

echo "==> SocialPost install"
echo "    user:   $DEPLOY_USER"
echo "    app:    $APP_DIR"
echo "    domain: $DOMAIN"
echo "    port:   $APP_PORT"
echo "    web:    $(detect_web_server)"
echo

ensure_build_deps
ensure_node_20
ensure_app_checkout
ensure_env_file
build_app
install_systemd
install_web_server
install_cron

WS="$(detect_web_server)"
CERTBOT_FLAVOR=nginx
[[ "$WS" == "apache" ]] && CERTBOT_FLAVOR=apache

echo
echo "Install complete."
echo
echo "Next steps:"
echo "  1. Point DNS for $DOMAIN to this droplet."
echo "  2. Enable HTTPS:"
echo "       sudo certbot --$CERTBOT_FLAVOR -d $DOMAIN"
echo "  3. Open https://$DOMAIN and create your account."
echo "  4. In Settings, set OAuth callback to:"
echo "       https://$DOMAIN/api/auth/x/callback"
echo "     (and the same URL in the X developer console)."
echo "  5. Check service: sudo systemctl status socialpost"
echo "  6. Logs:          journalctl -u socialpost -f"
