#!/usr/bin/env bash
# Pull latest code, rebuild, and restart. Run after the initial install.
#
# ./deploy/deploy.sh
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
source "$DEPLOY_DIR/lib.sh"

load_config

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "App not installed at $APP_DIR. Run ./deploy/install.sh first." >&2
  exit 1
fi

echo "==> Deploying SocialPost to $APP_DIR"

cd "$APP_DIR"
git fetch origin
git checkout "$GIT_BRANCH"
git pull --ff-only origin "$GIT_BRANCH"

npm install
npm run build

sudo systemctl restart socialpost
sudo systemctl --no-pager status socialpost

echo "Deploy complete: https://$DOMAIN"
