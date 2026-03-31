#!/bin/bash
# any-sync-push.sh — Push local changes directly to configured branch
# Usage: any-sync-push.sh <config-path> [lockfile-path]
# Output: JSON { "pushed": [...], "branch": "..." }
set -euo pipefail
shopt -s extglob

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/any-sync-lockfile.sh"

CONFIG_PATH="${1:-}"
LOCKFILE_PATH="${2:-.any-sync.lock}"

if [ -z "$CONFIG_PATH" ]; then
  echo "Usage: any-sync-push.sh <config-path> [lockfile-path]" >&2
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

ALL_PUSHED="[]"
LAST_BRANCH=""

MAPPING_COUNT=$(jq '.mappings | length' "$JQ_CONFIG_PATH")

for i in $(seq 0 $((MAPPING_COUNT - 1))); do
  NAME=$(jq -r ".mappings[$i].name" "$JQ_CONFIG_PATH")
  REPO=$(jq -r ".mappings[$i].repo" "$JQ_CONFIG_PATH")
  BRANCH=$(jq -r ".mappings[$i].branch // \"main\"" "$JQ_CONFIG_PATH")
  SOURCE_PATH=$(jq -r ".mappings[$i].sourcePath" "$JQ_CONFIG_PATH")
  DEST_PATH=$(jq -r ".mappings[$i].destPath" "$JQ_CONFIG_PATH")
  LAST_BRANCH="$BRANCH"

  # Expand tilde
  DEST_PATH="${DEST_PATH/#\~/$HOME}"

  if [ ! -d "$DEST_PATH" ]; then
    continue
  fi

  # Read include/exclude
  INCLUDE_JSON=$(jq -c ".mappings[$i].include // []" "$JQ_CONFIG_PATH")
  EXCLUDE_JSON=$(jq -c ".mappings[$i].exclude // []" "$JQ_CONFIG_PATH")

  OWNER="${REPO%%/*}"
  REPO_NAME="${REPO##*/}"

  # Normalize sourcePath
  SOURCE_PATH=$(echo "$SOURCE_PATH" | sed 's:^/*::;s:/*$::')

  # Find changed and new files
  TREE_ENTRIES="[]"

  while IFS= read -r -d '' LOCAL_FILE; do
    REL_PATH="${LOCAL_FILE#${DEST_PATH}/}"

    # Apply include filter
    INCLUDE_COUNT=$(echo "$INCLUDE_JSON" | jq 'length')
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
      if [ "$EXCLUDED" = "true" ]; then continue; fi
    fi

    # Check if file has changed since last sync
    LOCK_KEY=$(lockfile_make_key "$NAME" "$REL_PATH")
    ENTRY=$(lockfile_get_entry "$LOCK_KEY")
    CURRENT_HASH=$(hash_file "$LOCAL_FILE")

    IS_CHANGED="false"
    if [ "$ENTRY" = "null" ]; then
      IS_CHANGED="true"  # New file
    else
      STORED_HASH=$(echo "$ENTRY" | jq -r '.localHash')
      if [ "$CURRENT_HASH" != "$STORED_HASH" ]; then
        IS_CHANGED="true"  # Modified
      fi
    fi

    if [ "$IS_CHANGED" = "true" ]; then
      # Construct repo path: sourcePath/relativePath
      if [ -n "$SOURCE_PATH" ]; then
        REPO_PATH="${SOURCE_PATH}/${REL_PATH}"
      else
        REPO_PATH="$REL_PATH"
      fi

      # Create blob (base64 encoded, pipe via --input to avoid ARG_MAX on large files)
      BLOB_PAYLOAD=$(base64 < "$LOCAL_FILE" | jq -Rs '{"content": ., "encoding": "base64"}')
      BLOB_SHA=$(echo "$BLOB_PAYLOAD" | \
        gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/blobs" \
        --input - \
        --jq '.sha') || {
        echo "Error: Failed to create blob for $REL_PATH" >&2
        exit 1
      }

      TREE_ENTRIES=$(echo "$TREE_ENTRIES" | jq \
        --arg p "$REPO_PATH" \
        --arg s "$BLOB_SHA" \
        '. + [{"path": $p, "mode": "100644", "type": "blob", "sha": $s}]')

      ALL_PUSHED=$(echo "$ALL_PUSHED" | jq \
        --arg f "$REL_PATH" --arg m "$NAME" --arg bs "$BLOB_SHA" --arg lh "$CURRENT_HASH" \
        '. + [{"file": $f, "mapping": $m, "blobSha": $bs, "localHash": $lh}]')
    fi
  done < <(find "$DEST_PATH" -type f -print0 2>/dev/null)

  ENTRY_COUNT=$(echo "$TREE_ENTRIES" | jq 'length')
  if [ "$ENTRY_COUNT" -eq 0 ]; then
    continue
  fi

  # Get current commit SHA
  COMMIT_SHA=$(gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/ref/heads/${BRANCH}" \
    --jq '.object.sha') || {
    echo "Error: Failed to get commit SHA for branch $BRANCH" >&2
    exit 1
  }

  # Get base tree SHA
  BASE_TREE_SHA=$(gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/commits/${COMMIT_SHA}" \
    --jq '.tree.sha') || {
    echo "Error: Failed to get base tree SHA" >&2
    exit 1
  }

  # Create new tree (construct full payload with jq, pass via --input)
  PAYLOAD=$(jq -n --arg bt "$BASE_TREE_SHA" --argjson tree "$TREE_ENTRIES" \
    '{"base_tree": $bt, "tree": $tree}')
  NEW_TREE_SHA=$(echo "$PAYLOAD" | gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/trees" \
    --input - \
    --jq '.sha') || {
    echo "Error: Failed to create tree" >&2
    exit 1
  }

  # Create commit
  COMMIT_MSG="sync: Update ${ENTRY_COUNT} file(s) in ${SOURCE_PATH} via Any Sync"
  if [ "$ENTRY_COUNT" -eq 1 ]; then
    FIRST_FILE=$(echo "$TREE_ENTRIES" | jq -r '.[0].path')
    COMMIT_MSG="sync: Update ${FIRST_FILE} via Any Sync"
  fi

  NEW_COMMIT_SHA=$(jq -n \
    --arg msg "$COMMIT_MSG" \
    --arg tree "$NEW_TREE_SHA" \
    --arg parent "$COMMIT_SHA" \
    '{"message": $msg, "tree": $tree, "parents": [$parent]}' | \
    gh_api_retry "/repos/${OWNER}/${REPO_NAME}/git/commits" \
    --input - \
    --jq '.sha') || {
    echo "Error: Failed to create commit" >&2
    exit 1
  }

  # Update branch ref
  gh_api_retry -X PATCH "/repos/${OWNER}/${REPO_NAME}/git/refs/heads/${BRANCH}" \
    -f sha="$NEW_COMMIT_SHA" >/dev/null || {
    echo "Error: Failed to update branch ref. Another push may have occurred — try pulling first." >&2
    exit 1
  }

  # Update lockfile entries for pushed files
  for j in $(seq 0 $(($(echo "$ALL_PUSHED" | jq 'length') - 1))); do
    F_MAPPING=$(echo "$ALL_PUSHED" | jq -r ".[$j].mapping")
    if [ "$F_MAPPING" != "$NAME" ]; then continue; fi
    F_FILE=$(echo "$ALL_PUSHED" | jq -r ".[$j].file")
    F_BLOB_SHA=$(echo "$ALL_PUSHED" | jq -r ".[$j].blobSha")
    F_LOCAL_HASH=$(echo "$ALL_PUSHED" | jq -r ".[$j].localHash")
    LOCK_KEY=$(lockfile_make_key "$NAME" "$F_FILE")
    lockfile_set_entry "$LOCK_KEY" "$F_BLOB_SHA" "$F_LOCAL_HASH"
  done

  lockfile_set_last_sync "$NAME"
done

lockfile_save

# Output summary (strip internal fields)
jq -n --argjson pushed "$(echo "$ALL_PUSHED" | jq '[.[] | {file, mapping}]')" \
  --arg branch "${LAST_BRANCH:-main}" \
  '{"pushed": $pushed, "branch": $branch}'
