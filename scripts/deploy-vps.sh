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
# Vite's /assets/ files have a content hash in their name, so they can be kept for good.
map "$sent_http_content_type|$uri" $oldstylegaming_html_expires {
    default        off;
    ~*^text/html   epoch;
    ~*\|/assets/   max;
}

expires $oldstylegaming_html_expires;
EOF

  if ! nginx -t; then
    rm -f "$cache_policy"
    echo "Invalid nginx cache policy removed; existing nginx configuration was left unchanged."
    return 1
  fi
}

install_compression_policy() {
  local nginx_conf_dir="/etc/nginx/conf.d"
  local compression_policy="$nginx_conf_dir/oldstylegaming-compression.conf"

  if ! command -v nginx >/dev/null 2>&1 || [ ! -d "$nginx_conf_dir" ]; then
    return 0
  fi

  if [ ! -w "$nginx_conf_dir" ]; then
    log "Cannot update nginx compression policy without write access to $nginx_conf_dir"
    return 0
  fi

  log "Installing nginx compression policy"
  # Ubuntu's nginx.conf turns gzip on but only for HTML; the app bundle and
  # emulator cores were sent uncompressed. If nginx.conf already sets one of
  # these, nginx -t fails and the file is removed again.
  cat >"$compression_policy" <<'EOF'
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_types text/css text/javascript application/javascript application/json application/wasm image/svg+xml text/plain application/xml;
EOF

  if ! nginx -t; then
    rm -f "$compression_policy"
    echo "Invalid nginx compression policy removed; existing nginx configuration was left unchanged."
    return 1
  fi
}

install_upload_policy() {
  local nginx_conf_dir="/etc/nginx/conf.d"
  local upload_policy="$nginx_conf_dir/oldstylegaming-upload-limits.conf"

  if ! command -v nginx >/dev/null 2>&1 || [ ! -d "$nginx_conf_dir" ]; then
    return 0
  fi

  if [ ! -w "$nginx_conf_dir" ]; then
    log "Cannot update nginx upload policy without write access to $nginx_conf_dir"
    return 0
  fi

  log "Installing nginx tournament upload policy"
  cat >"$upload_policy" <<'EOF'
# Tournament ROM uploads are validated and capped at 256 MiB by FastAPI.
# Allow a little extra space here for multipart form boundaries and fields.
client_max_body_size 260m;
EOF

  if ! nginx -t; then
    rm -f "$upload_policy"
    echo "Invalid nginx upload policy removed; existing nginx configuration was left unchanged."
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
install_compression_policy || true
install_upload_policy

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
