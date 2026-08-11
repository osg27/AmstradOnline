#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/amstrad-multiplayer}"
FRONTEND_DIR="$APP_DIR/frontend"
BACKEND_DIR="$APP_DIR/backend"

log() {
  printf '\n==> %s\n' "$1"
}

restart_if_active() {
  local service="$1"

  if systemctl list-unit-files "$service" >/dev/null 2>&1; then
    log "Restarting $service"
    systemctl restart "$service"
    return 0
  fi

  return 1
}

install_html_cache_policy() {
  local nginx_conf_dir="/etc/nginx/conf.d"
  local cache_policy="$nginx_conf_dir/oldstylegaming-html-cache.conf"

  if ! command -v nginx >/dev/null 2>&1 || [ ! -d "$nginx_conf_dir" ]; then
    return 0
  fi

  if [ ! -w "$nginx_conf_dir" ]; then
    log "Cannot update nginx HTML cache policy without write access to $nginx_conf_dir"
    return 0
  fi

  log "Installing nginx HTML revalidation policy"
  cat >"$cache_policy" <<'EOF'
# The Vite HTML shell contains fingerprinted CSS/JS filenames and must never be
# reused without validation. Other content types retain their existing cache
# policy, including ROMs, artwork and immutable frontend bundles.
map $sent_http_content_type $oldstylegaming_html_expires {
    default     off;
    ~*text/html epoch;
}

expires $oldstylegaming_html_expires;
EOF

  if ! nginx -t; then
    rm -f "$cache_policy"
    echo "Invalid nginx cache policy removed; existing nginx configuration was left unchanged."
    return 1
  fi
}

cd "$APP_DIR"

log "Pulling latest code"
git pull

if [ -d "$FRONTEND_DIR" ]; then
  log "Building frontend"
  cd "$FRONTEND_DIR"
  npm install
  npm run build
fi

if [ -f "$BACKEND_DIR/requirements.txt" ]; then
  if [ -d "$BACKEND_DIR/.venv" ]; then
    log "Updating backend Python dependencies"
    cd "$BACKEND_DIR"
    # shellcheck disable=SC1091
    source .venv/bin/activate
    pip install -r requirements.txt
  elif [ -d "$BACKEND_DIR/venv" ]; then
    log "Updating backend Python dependencies"
    cd "$BACKEND_DIR"
    # shellcheck disable=SC1091
    source venv/bin/activate
    pip install -r requirements.txt
  elif [ -d "$APP_DIR/venv" ]; then
    log "Updating backend Python dependencies"
    cd "$APP_DIR"
    # shellcheck disable=SC1091
    source venv/bin/activate
    pip install -r "$BACKEND_DIR/requirements.txt"
  else
    log "No Python venv found, skipping backend dependency install"
  fi
fi

log "Restarting known services"
restarted=0

install_html_cache_policy

for service in \
  amstrad-backend.service \
  amstrad-frontend.service \
  amstrad.service \
  nginx.service
do
  if restart_if_active "$service"; then
    restarted=1
  fi
done

if command -v docker >/dev/null 2>&1 && [ -f "$APP_DIR/docker-compose.yml" ]; then
  cd "$APP_DIR"
  if docker compose ps >/dev/null 2>&1; then
    log "Docker Compose detected, rebuilding containers"
    docker compose up --build -d
    restarted=1
  fi
fi

if [ "$restarted" -eq 0 ]; then
  log "No known services were restarted"
  echo "Run this to find what is serving the app:"
  echo "  ss -tulpn | grep -E '5173|8000|80|443'"
  echo "  systemctl list-units --type=service | grep -Ei 'amstrad|nginx|uvicorn|vite|node'"
fi

log "Deploy complete"
