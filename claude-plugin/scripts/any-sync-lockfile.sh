#!/bin/bash
# any-sync-lockfile.sh — Lockfile read/write/compare utilities
# Source this file: source "$(dirname "$0")/any-sync-lockfile.sh"
#
# Requires: jq, sha256sum or shasum
#
# Functions:
#   lockfile_init <path>          — Set lockfile path, load or create empty
#   lockfile_save                 — Write lockfile atomically (tmp + mv)
#   lockfile_get_entry <key>      — Print JSON entry for key, or "null"
#   lockfile_set_entry <key> <remoteSha> <localHash>  — Set/update entry
#   lockfile_get_entries_for_mapping <name>  — Print all entries for mapping
#   lockfile_set_last_sync <name> — Update lastSync timestamp
#   lockfile_get_last_sync <name> — Print lastSync for mapping, or "null"
#   hash_file <path>              — Print bare hex SHA-256 of file
#   lockfile_make_key <mapping> <relpath>  — Print "mapping::relpath"
#   gh_api_retry <args...>        — Retry gh api on 5xx/network errors (3 attempts, exponential backoff)

# Detect hash command (macOS uses shasum, Linux uses sha256sum)
if command -v sha256sum >/dev/null 2>&1; then
  _HASH_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  _HASH_CMD="shasum -a 256"
else
  echo "Error: Neither sha256sum nor shasum found." >&2
  exit 1
fi

_LOCKFILE_PATH=""
_LOCKFILE_DATA=""

lockfile_init() {
  _LOCKFILE_PATH="$1"
  if [ -f "$_LOCKFILE_PATH" ]; then
    _LOCKFILE_DATA=$(cat "$_LOCKFILE_PATH")
    # Validate structure
    local version
    version=$(echo "$_LOCKFILE_DATA" | jq -r '.version // empty' 2>/dev/null) || true
    if [ "$version" != "1" ]; then
      _LOCKFILE_DATA='{"version":1,"files":{},"lastSync":{}}'
    fi
  else
    _LOCKFILE_DATA='{"version":1,"files":{},"lastSync":{}}'
  fi
}

lockfile_save() {
  local tmp
  tmp=$(mktemp "${_LOCKFILE_PATH}.XXXXXX")
  echo "$_LOCKFILE_DATA" | jq '.' > "$tmp"
  mv "$tmp" "$_LOCKFILE_PATH"
}

lockfile_make_key() {
  echo "${1}::${2}"
}

lockfile_get_entry() {
  local key="$1"
  echo "$_LOCKFILE_DATA" | jq -r --arg k "$key" '.files[$k] // null'
}

lockfile_set_entry() {
  local key="$1"
  local remote_sha="$2"
  local local_hash="$3"
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  _LOCKFILE_DATA=$(echo "$_LOCKFILE_DATA" | jq \
    --arg k "$key" \
    --arg rs "$remote_sha" \
    --arg lh "$local_hash" \
    --arg ts "$now" \
    '.files[$k] = {"remoteSha": $rs, "localHash": $lh, "syncedAt": $ts}')
}

lockfile_get_entries_for_mapping() {
  local name="$1"
  local prefix="${name}::"
  echo "$_LOCKFILE_DATA" | jq --arg p "$prefix" \
    '[.files | to_entries[] | select(.key | startswith($p)) | {key: (.key | ltrimstr($p)), value: .value}] | from_entries'
}

lockfile_set_last_sync() {
  local name="$1"
  local now
  now=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  _LOCKFILE_DATA=$(echo "$_LOCKFILE_DATA" | jq \
    --arg n "$name" --arg ts "$now" \
    '.lastSync[$n] = $ts')
}

lockfile_get_last_sync() {
  local name="$1"
  echo "$_LOCKFILE_DATA" | jq -r --arg n "$name" '.lastSync[$n] // null'
}

hash_file() {
  local filepath="$1"
  $_HASH_CMD "$filepath" | cut -d' ' -f1
}

# Retry wrapper for gh api calls (3 attempts, exponential backoff: 1s, 2s, 4s)
# Only retries on 5xx errors and network failures
gh_api_retry() {
  local attempt=0
  local max_attempts=3
  local backoff=1
  local output
  local exit_code

  while [ $attempt -lt $max_attempts ]; do
    output=$(gh api "$@" 2>&1) && {
      echo "$output"
      return 0
    }
    exit_code=$?
    attempt=$((attempt + 1))

    # Check if it's a retryable error (5xx or network failure)
    case "$output" in
      *"502"*|*"503"*|*"500"*|*"504"*|*"connect"*|*"timeout"*|*"network"*)
        if [ $attempt -lt $max_attempts ]; then
          sleep $backoff
          backoff=$((backoff * 2))
        fi
        ;;
      *)
        # Non-retryable error (4xx, auth, etc.) — fail immediately
        echo "$output" >&2
        return $exit_code
        ;;
    esac
  done

  echo "$output" >&2
  return $exit_code
}
