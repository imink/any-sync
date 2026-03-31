#!/bin/bash
# any-sync-pull.sh — Pull files from GitHub
# Usage: any-sync-pull.sh <config-path> [lockfile-path]
# Output: JSON { "pulled": [...], "conflicts": [...], "skipped": [...] }
set -euo pipefail
shopt -s extglob

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/any-sync-lockfile.sh"

CONFIG_PATH="${1:-}"
LOCKFILE_PATH="${2:-.any-sync.lock}"

if [ -z "$CONFIG_PATH" ]; then
  echo "Usage: any-sync-pull.sh <config-path> [lockfile-path]" >&2
  exit 1
fi

if [ ! -f "$CONFIG_PATH" ]; then
  echo "Error: Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

# Convert paths for native Windows binaries (jq.exe)
JQ_CONFIG_PATH=$(_winpath "$CONFIG_PATH")

# Ensure auth
TOKEN=$("${SCRIPT_DIR}/any-sync-auth.sh") || exit 1
export GITHUB_TOKEN="$TOKEN"

lockfile_init "$LOCKFILE_PATH"

PULLED="[]"
CONFLICTS="[]"
SKIPPED="[]"

MAPPING_COUNT=$(jq '.mappings | length' "$JQ_CONFIG_PATH")

for i in $(seq 0 $((MAPPING_COUNT - 1))); do
  NAME=$(jq -r ".mappings[$i].name" "$JQ_CONFIG_PATH")
  REPO=$(jq -r ".mappings[$i].repo" "$JQ_CONFIG_PATH")
  BRANCH=$(jq -r ".mappings[$i].branch // \"main\"" "$JQ_CONFIG_PATH")
  SOURCE_PATH=$(jq -r ".mappings[$i].sourcePath" "$JQ_CONFIG_PATH")
  DEST_PATH=$(jq -r ".mappings[$i].destPath" "$JQ_CONFIG_PATH")

  # Expand tilde
  DEST_PATH="${DEST_PATH/#\~/$HOME}"

  # Read include/exclude arrays
  INCLUDE_JSON=$(jq -c ".mappings[$i].include // []" "$JQ_CONFIG_PATH")
  EXCLUDE_JSON=$(jq -c ".mappings[$i].exclude // []" "$JQ_CONFIG_PATH")

  OWNER="${REPO%%/*}"
  REPO_NAME="${REPO##*/}"

  # Normalize sourcePath (strip leading/trailing slashes)
  SOURCE_PATH=$(echo "$SOURCE_PATH" | sed 's:^/*::;s:/*$::')
  PREFIX=""
  if [ -n "$SOURCE_PATH" ]; then
    PREFIX="${SOURCE_PATH}/"
  fi

  # Fetch recursive tree, filter by prefix using jq --arg for safety
  TREE=$(gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1" \
    --jq ".tree[] | select(.type == \"blob\")" 2>/dev/null) || {
    echo "Error: Failed to fetch tree for ${REPO} branch ${BRANCH}" >&2
    continue
  }

  # Filter by prefix locally using jq with --arg to avoid injection
  if [ -n "$PREFIX" ]; then
    TREE=$(echo "$TREE" | jq -c --arg pfx "$PREFIX" 'select(.path | startswith($pfx))')
  fi

  # Guard against empty tree
  if [ -z "$TREE" ]; then
    lockfile_set_last_sync "$NAME"
    continue
  fi

  # Process each file in the tree
  while IFS=$'\t' read -r FILE_PATH FILE_SHA; do
    [ -z "$FILE_PATH" ] && continue

    # Make path relative to sourcePath
    REL_PATH="${FILE_PATH#${PREFIX}}"

    # Apply include/exclude filters
    # Simple glob matching: if include is set, file must match at least one pattern
    INCLUDE_COUNT=$(echo "$INCLUDE_JSON" | jq 'length')
    if [ "$INCLUDE_COUNT" -gt 0 ]; then
      MATCHED="false"
      for pi in $(seq 0 $((INCLUDE_COUNT - 1))); do
        PATTERN=$(echo "$INCLUDE_JSON" | jq -r ".[$pi]")
        # Handle **/*.ext → *.ext for fnmatch-like matching
        SIMPLE_PATTERN=$(echo "$PATTERN" | sed 's:\*\*/::g')
        case "$REL_PATH" in
          $SIMPLE_PATTERN) MATCHED="true"; break ;;
        esac
      done
      if [ "$MATCHED" = "false" ]; then
        continue
      fi
    fi

    # Exclude filter
    EXCLUDE_COUNT=$(echo "$EXCLUDE_JSON" | jq 'length')
    if [ "$EXCLUDE_COUNT" -gt 0 ]; then
      EXCLUDED="false"
      for pi in $(seq 0 $((EXCLUDE_COUNT - 1))); do
        PATTERN=$(echo "$EXCLUDE_JSON" | jq -r ".[$pi]")
        SIMPLE_PATTERN=$(echo "$PATTERN" | sed 's:\*\*/::g')
        case "$REL_PATH" in
          $SIMPLE_PATTERN) EXCLUDED="true"; break ;;
        esac
      done
      if [ "$EXCLUDED" = "true" ]; then
        continue
      fi
    fi

    LOCK_KEY=$(lockfile_make_key "$NAME" "$REL_PATH")
    ENTRY=$(lockfile_get_entry "$LOCK_KEY")

    LOCAL_FILE="${DEST_PATH}/${REL_PATH}"

    if [ "$ENTRY" != "null" ]; then
      STORED_REMOTE_SHA=$(echo "$ENTRY" | jq -r '.remoteSha')
      STORED_LOCAL_HASH=$(echo "$ENTRY" | jq -r '.localHash')

      # Remote unchanged → skip
      if [ "$STORED_REMOTE_SHA" = "$FILE_SHA" ]; then
        SKIPPED=$(echo "$SKIPPED" | jq --arg f "$REL_PATH" --arg m "$NAME" \
          '. + [{"file": $f, "mapping": $m, "reason": "unchanged"}]')
        continue
      fi

      # Remote changed — check if local also changed
      if [ -f "$LOCAL_FILE" ]; then
        CURRENT_LOCAL_HASH=$(hash_file "$LOCAL_FILE")
        if [ "$CURRENT_LOCAL_HASH" != "$STORED_LOCAL_HASH" ]; then
          # Conflict: both remote and local changed
          CONFLICTS=$(echo "$CONFLICTS" | jq --arg f "$REL_PATH" --arg m "$NAME" \
            '. + [{"file": $f, "mapping": $m}]')
          continue
        fi
      fi
    fi

    # Download the blob
    BLOB_CONTENT=$(gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/blobs/${FILE_SHA}" \
      --jq '.content' 2>/dev/null) || {
      echo "Error: Failed to download blob for $REL_PATH" >&2
      continue
    }

    # Write atomically: decode base64, write to tmp, mv to dest
    mkdir -p "$(dirname "$LOCAL_FILE")"
    TMP_FILE=$(mktemp "${LOCAL_FILE}.XXXXXX")
    echo "$BLOB_CONTENT" | base64 -d > "$TMP_FILE"
    mv "$TMP_FILE" "$LOCAL_FILE"

    # Compute hash of downloaded content and update lockfile
    NEW_LOCAL_HASH=$(hash_file "$LOCAL_FILE")
    lockfile_set_entry "$LOCK_KEY" "$FILE_SHA" "$NEW_LOCAL_HASH"

    PULLED=$(echo "$PULLED" | jq --arg f "$REL_PATH" --arg m "$NAME" \
      '. + [{"file": $f, "mapping": $m}]')

  done < <(echo "$TREE" | jq -r '[.path, .sha] | @tsv')

  lockfile_set_last_sync "$NAME"
done

lockfile_save

# Output summary
jq -n --argjson pulled "$PULLED" --argjson conflicts "$CONFLICTS" --argjson skipped "$SKIPPED" \
  '{"pulled": $pulled, "conflicts": $conflicts, "skipped": $skipped}'
