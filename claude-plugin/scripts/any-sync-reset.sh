#!/bin/bash
# any-sync-reset.sh — Delete config and lockfile
# Usage: any-sync-reset.sh <config-path> [lockfile-path]
# Output: JSON summary of what was cleared
set -euo pipefail

CONFIG_PATH="${1:-}"
LOCKFILE_PATH="${2:-.any-sync.lock}"

if [ -z "$CONFIG_PATH" ]; then
  echo "Usage: any-sync-reset.sh <config-path> [lockfile-path]" >&2
  exit 1
fi

DELETED_CONFIG="false"
DELETED_LOCKFILE="false"

if [ -f "$CONFIG_PATH" ]; then
  rm "$CONFIG_PATH"
  DELETED_CONFIG="true"
fi

if [ -f "$LOCKFILE_PATH" ]; then
  rm "$LOCKFILE_PATH"
  DELETED_LOCKFILE="true"
fi

printf '{"deletedConfig": %s, "configPath": "%s", "deletedLockfile": %s, "lockfilePath": "%s"}\n' \
  "$DELETED_CONFIG" "$CONFIG_PATH" "$DELETED_LOCKFILE" "$LOCKFILE_PATH"
