#!/usr/bin/env bash
set -euo pipefail

SITE_CONFIG="${SITE_CONFIG:-/etc/nginx/sites-enabled/oldstylegaming}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script with sudo."
  exit 1
fi

if [ ! -f "$SITE_CONFIG" ]; then
  echo "Nginx site config not found: $SITE_CONFIG"
  exit 1
fi

TARGET_CONFIG="$(readlink -f "$SITE_CONFIG")"
BACKUP_CONFIG="${TARGET_CONFIG}.before-threaded-emulators"

if grep -q 'Cross-Origin-Embedder-Policy' "$TARGET_CONFIG"; then
  echo "Cross-origin isolation headers are already present."
  nginx -t
  systemctl reload nginx
  exit 0
fi

cp -p "$TARGET_CONFIG" "$BACKUP_CONFIG"

sed -i '/^[[:space:]]*index index\.html;[[:space:]]*$/a\
\
    # Required by threaded WebAssembly emulator cores.\
    add_header Cross-Origin-Opener-Policy "same-origin" always;\
    add_header Cross-Origin-Embedder-Policy "credentialless" always;\
    add_header Cross-Origin-Resource-Policy "cross-origin" always;' "$TARGET_CONFIG"

if ! nginx -t; then
  cp -p "$BACKUP_CONFIG" "$TARGET_CONFIG"
  echo "Nginx validation failed; restored $BACKUP_CONFIG"
  exit 1
fi

systemctl reload nginx
echo "Threaded WebAssembly headers enabled."
echo "Backup: $BACKUP_CONFIG"
