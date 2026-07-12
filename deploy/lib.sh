#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

load_config() {
  local config="$DEPLOY_DIR/config.env"
  if [[ ! -f "$config" ]]; then
    echo "Missing $config" >&2
    echo "Copy deploy/config.env.example to deploy/config.env and edit it." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$config"

  if [[ -z "${DEPLOY_USER:-}" ]]; then
    DEPLOY_USER="$(id -un)"
  fi
  if [[ -z "${APP_DIR:-}" ]]; then
    APP_DIR="$HOME/socialpost"
  fi
  if [[ -z "${DOMAIN:-}" ]]; then
    echo "DOMAIN is required in deploy/config.env" >&2
    exit 1
  fi
  APP_PORT="${APP_PORT:-3000}"
  GIT_REPO="${GIT_REPO:-git@github.com:kothinti/socialpost.git}"
  GIT_BRANCH="${GIT_BRANCH:-main}"
  CRON_SCHEDULE="${CRON_SCHEDULE:-0 9 * * *}"
  WEB_SERVER="${WEB_SERVER:-auto}"

  export DEPLOY_USER APP_DIR DOMAIN APP_PORT GIT_REPO GIT_BRANCH CRON_SCHEDULE WEB_SERVER
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd" >&2
    exit 1
  fi
}

node_major_version() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

ensure_node_20() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node_major_version)"
    if [[ "$major" -ge 20 ]]; then
      echo "Node $(node -v) OK"
      return
    fi
    echo "Node 20+ required (found $(node -v)). Installing via NodeSource..."
  else
    echo "Node not found. Installing Node 20 via NodeSource..."
  fi

  require_command curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  echo "Installed Node $(node -v)"
}

ensure_build_deps() {
  echo "Installing build dependencies..."
  sudo apt-get update
  sudo apt-get install -y build-essential python3 git
}

ensure_app_checkout() {
  if [[ ! -d "$APP_DIR/.git" ]]; then
    echo "Cloning $GIT_REPO -> $APP_DIR"
    git clone --branch "$GIT_BRANCH" "$GIT_REPO" "$APP_DIR"
  else
    echo "Repo already exists at $APP_DIR"
    git -C "$APP_DIR" fetch origin
    git -C "$APP_DIR" checkout "$GIT_BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$GIT_BRANCH" || true
  fi
}

ensure_env_file() {
  if [[ ! -f "$APP_DIR/.env.local" ]]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env.local"
    if command -v openssl >/dev/null 2>&1; then
      local secret cron_secret
      secret="$(openssl rand -base64 32)"
      cron_secret="$(openssl rand -base64 32)"
      sed -i "s|AUTH_SECRET=.*|AUTH_SECRET=$secret|" "$APP_DIR/.env.local"
      sed -i "s|CRON_SECRET=.*|CRON_SECRET=$cron_secret|" "$APP_DIR/.env.local"
    fi
    echo "Created $APP_DIR/.env.local with random secrets."
    echo "Set APP_URL=https://$DOMAIN and MONGODB_URI in .env.local before starting."
  fi

  if grep -q '^APP_URL=http://localhost' "$APP_DIR/.env.local" 2>/dev/null; then
    sed -i "s|^APP_URL=.*|APP_URL=https://$DOMAIN|" "$APP_DIR/.env.local"
    echo "Updated APP_URL to https://$DOMAIN"
  fi
}

build_app() {
  cd "$APP_DIR"
  mkdir -p data/uploads
  npm install
  npm run build
}

install_systemd() {
  local service_path="/etc/systemd/system/socialpost.service"
  bash "$DEPLOY_DIR/render.sh" \
    "$DEPLOY_DIR/socialpost.service.tpl" \
    "/tmp/socialpost.service"
  sudo cp "/tmp/socialpost.service" "$service_path"
  sudo systemctl daemon-reload
  sudo systemctl enable socialpost
  sudo systemctl restart socialpost
  echo "systemd service installed: socialpost"
}

detect_web_server() {
  if [[ "$WEB_SERVER" != "auto" ]]; then
    echo "$WEB_SERVER"
    return
  fi
  if command -v apache2ctl >/dev/null 2>&1; then
    if systemctl is-active --quiet apache2 2>/dev/null; then
      echo apache
      return
    fi
  fi
  if command -v nginx >/dev/null 2>&1; then
    if systemctl is-active --quiet nginx 2>/dev/null; then
      echo nginx
      return
    fi
  fi
  if command -v apache2ctl >/dev/null 2>&1; then
    echo apache
    return
  fi
  echo nginx
}

install_nginx_site() {
  require_command nginx
  local available="/etc/nginx/sites-available/socialpost"
  local enabled="/etc/nginx/sites-enabled/socialpost"

  bash "$DEPLOY_DIR/render.sh" \
    "$DEPLOY_DIR/nginx-socialpost.conf.tpl" \
    "/tmp/socialpost.nginx"

  sudo cp "/tmp/socialpost.nginx" "$available"
  if [[ ! -e "$enabled" ]]; then
    sudo ln -s "$available" "$enabled"
  fi
  sudo nginx -t
  sudo systemctl reload nginx
  echo "nginx site enabled for $DOMAIN"
}

install_apache_site() {
  require_command apache2ctl
  sudo a2enmod proxy proxy_http rewrite headers >/dev/null

  bash "$DEPLOY_DIR/render.sh" \
    "$DEPLOY_DIR/apache-socialpost.conf.tpl" \
    "/tmp/socialpost.apache"

  sudo cp "/tmp/socialpost.apache" "/etc/apache2/sites-available/socialpost.conf"
  sudo a2ensite socialpost.conf >/dev/null
  sudo apache2ctl configtest
  sudo systemctl reload apache2
  echo "Apache site enabled for $DOMAIN"
}

install_web_server() {
  local ws
  ws="$(detect_web_server)"
  case "$ws" in
    apache) install_apache_site ;;
    nginx) install_nginx_site ;;
    *)
      echo "Unknown WEB_SERVER=$ws (use apache, nginx, or auto)" >&2
      exit 1
      ;;
  esac
}

install_cron() {
  local cron_path="/etc/cron.d/socialpost"
  chmod +x "$APP_DIR/deploy/run-cron.sh"
  bash "$DEPLOY_DIR/render.sh" \
    "$DEPLOY_DIR/cron-socialpost.tpl" \
    "/tmp/socialpost.cron"
  sudo cp "/tmp/socialpost.cron" "$cron_path"
  sudo chmod 644 "$cron_path"
  echo "cron job installed ($CRON_SCHEDULE)"
}
