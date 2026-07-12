#!/usr/bin/env bash
# Substitute __PLACEHOLDER__ tokens in a template file.
set -euo pipefail

template="${1:?template path required}"
output="${2:?output path required}"

if [[ ! -f "$template" ]]; then
  echo "Template not found: $template" >&2
  exit 1
fi

content="$(<"$template")"
content="${content//__DEPLOY_USER__/$DEPLOY_USER}"
content="${content//__APP_DIR__/$APP_DIR}"
content="${content//__DOMAIN__/$DOMAIN}"
content="${content//__APP_PORT__/$APP_PORT}"
content="${content//__CRON_SCHEDULE__/$CRON_SCHEDULE}"

printf '%s\n' "$content" >"$output"
