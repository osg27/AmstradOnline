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
  if [ -d "$BACKEND_DIR/venv" ]; then
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
