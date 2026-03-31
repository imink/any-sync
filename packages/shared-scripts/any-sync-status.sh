#!/bin/bash
# any-sync-status.sh — Show sync state
# Usage: any-sync-status.sh <config-path> [lockfile-path]
# Output: JSON with auth, config, and per-mapping status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/any-sync-lockfile.sh"

CONFIG_PATH="${1:-}"
LOCKFILE_PATH="${2:-.any-sync.lock}"

if [ -z "$CONFIG_PATH" ]; then
  echo "Usage: any-sync-status.sh <config-path> [lockfile-path]" >&2
  exit 1
fi

# Check auth
AUTH_METHOD="none"
AUTH_USER=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  AUTH_METHOD="token"
  AUTH_USER=$(gh api /user --jq '.login' 2>/dev/null) || AUTH_USER="unknown"
elif command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
  AUTH_METHOD="gh"
  AUTH_USER=$(gh api /user --jq '.login' 2>/dev/null) || AUTH_USER="unknown"
fi

# Check config
CONFIG_VALID="false"
if [ -f "$CONFIG_PATH" ]; then
  if jq -e '.mappings | type == "array"' "$CONFIG_PATH" >/dev/null 2>&1; then
    CONFIG_VALID="true"
  fi
fi

# Build mappings status
lockfile_init "$LOCKFILE_PATH"

MAPPINGS_JSON="[]"
if [ "$CONFIG_VALID" = "true" ]; then
  MAPPING_COUNT=$(jq '.mappings | length' "$CONFIG_PATH")
  for i in $(seq 0 $((MAPPING_COUNT - 1))); do
    NAME=$(jq -r ".mappings[$i].name" "$CONFIG_PATH")
    REPO=$(jq -r ".mappings[$i].repo" "$CONFIG_PATH")
    BRANCH=$(jq -r ".mappings[$i].branch // \"main\"" "$CONFIG_PATH")
    DEST_PATH=$(jq -r ".mappings[$i].destPath" "$CONFIG_PATH")
    LAST_SYNC=$(lockfile_get_last_sync "$NAME")

    # Expand tilde
    DEST_PATH="${DEST_PATH/#\~/$HOME}"

    # Count tracked files and detect changes
    TRACKED=0
    CHANGES="[]"
    ENTRIES=$(lockfile_get_entries_for_mapping "$NAME")
    TRACKED=$(echo "$ENTRIES" | jq 'length')

    # Check each tracked file for local changes
    while IFS= read -r KEY; do
      [ -z "$KEY" ] && continue
      STORED_HASH=$(echo "$ENTRIES" | jq -r --arg k "$KEY" '.[$k].localHash')
      LOCAL_FILE="${DEST_PATH}/${KEY}"
      if [ -f "$LOCAL_FILE" ]; then
        CURRENT_HASH=$(hash_file "$LOCAL_FILE")
        if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
          CHANGES=$(echo "$CHANGES" | jq --arg f "$KEY" --arg t "modified" \
            '. + [{"file": $f, "type": $t}]')
        fi
      fi
    done < <(echo "$ENTRIES" | jq -r 'keys[]')

    # Check for new files (not tracked in lockfile)
    if [ -d "$DEST_PATH" ]; then
      # Read include/exclude from config for filtering
      INCLUDE_JSON=$(jq -c ".mappings[$i].include // []" "$CONFIG_PATH")
      EXCLUDE_JSON=$(jq -c ".mappings[$i].exclude // []" "$CONFIG_PATH")
      INCLUDE_COUNT=$(echo "$INCLUDE_JSON" | jq 'length')
      EXCLUDE_COUNT=$(echo "$EXCLUDE_JSON" | jq 'length')

      while IFS= read -r -d '' LOCAL_FILE; do
        REL_PATH="${LOCAL_FILE#${DEST_PATH}/}"

        # Apply include filter
        if [ "$INCLUDE_COUNT" -gt 0 ]; then
          MATCHED="false"
          for pi in $(seq 0 $((INCLUDE_COUNT - 1))); do
            PATTERN=$(echo "$INCLUDE_JSON" | jq -r ".[$pi]")
            SIMPLE_PATTERN=$(echo "$PATTERN" | sed 's:\*\*/::g')
            case "$REL_PATH" in
              $SIMPLE_PATTERN) MATCHED="true"; break ;;
            esac
          done
          if [ "$MATCHED" = "false" ]; then continue; fi
        fi

        # Apply exclude filter
        if [ "$EXCLUDE_COUNT" -gt 0 ]; then
          EXCLUDED="false"
          for pi in $(seq 0 $((EXCLUDE_COUNT - 1))); do
            PATTERN=$(echo "$EXCLUDE_JSON" | jq -r ".[$pi]")
            SIMPLE_PATTERN=$(echo "$PATTERN" | sed 's:\*\*/::g')
            case "$REL_PATH" in
              $SIMPLE_PATTERN) EXCLUDED="true"; break ;;
            esac
          done
          if [ "$EXCLUDED" = "true" ]; then continue; fi
        fi

        LOCK_KEY=$(lockfile_make_key "$NAME" "$REL_PATH")
        ENTRY=$(lockfile_get_entry "$LOCK_KEY")
        if [ "$ENTRY" = "null" ]; then
          CHANGES=$(echo "$CHANGES" | jq --arg f "$REL_PATH" --arg t "new" \
            '. + [{"file": $f, "type": $t}]')
        fi
      done < <(find "$DEST_PATH" -type f -print0 2>/dev/null)
    fi

    MAPPINGS_JSON=$(echo "$MAPPINGS_JSON" | jq \
      --arg n "$NAME" \
      --arg r "$REPO" \
      --arg b "$BRANCH" \
      --arg ls "$LAST_SYNC" \
      --argjson tf "$TRACKED" \
      --argjson ch "$CHANGES" \
      '. + [{"name": $n, "repo": $r, "branch": $b, "lastSync": $ls, "trackedFiles": $tf, "changes": $ch}]')
  done
fi

# Output final JSON
jq -n \
  --arg am "$AUTH_METHOD" \
  --arg au "$AUTH_USER" \
  --arg cp "$CONFIG_PATH" \
  --arg cv "$CONFIG_VALID" \
  --argjson mappings "$MAPPINGS_JSON" \
  '{
    "auth": {"method": $am, "user": $au},
    "config": {"path": $cp, "valid": ($cv == "true")},
    "mappings": $mappings
  }'
