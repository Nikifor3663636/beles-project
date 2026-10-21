#!/bin/sh
set -eu
if [ "$(id -u)" = "0" ]; then
  storage="${BELES_STORAGE_DIR:-/app}"
  mkdir -p "$storage/data" "$storage/uploads"
  chown node:node "$storage/data" "$storage/uploads"
  exec su-exec node:node "$@"
fi
exec "$@"
