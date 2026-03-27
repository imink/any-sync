# Any Sync Claude Code Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained Claude Code plugin to the skills-sync-plugin monorepo that syncs files between local directories and GitHub repos via shell scripts.

**Architecture:** Shell scripts calling `gh` CLI for all GitHub API operations, wrapped in Claude Code skills (slash commands) and hooks. The plugin lives in `claude-plugin/` and shares the `.any-sync.lock` lockfile format with the existing VS Code extension.

**Tech Stack:** Bash (3.2+), `gh` CLI, `jq`, POSIX utilities (`sha256sum`/`shasum`, `base64`, `mktemp`, `mv`)

**Spec:** `docs/superpowers/specs/2026-03-26-any-sync-claude-plugin-design.md`

---

## File Structure

```
claude-plugin/
  .claude-plugin/plugin.json                  # Plugin metadata
  .gitattributes                              # LF line endings enforcement
  scripts/
    any-sync-auth.sh                          # Auth check (GITHUB_TOKEN → gh fallback)
    any-sync-lockfile.sh                      # Lockfile read/write/compare utilities
    any-sync-init.sh                          # Create/validate config
    any-sync-reset.sh                         # Clear config + delete lockfile
    any-sync-status.sh                        # Show sync state
    any-sync-pull.sh                          # Core pull logic
    any-sync-push.sh                          # Core push logic (direct to branch)
  hooks/
    hooks.json                                # SessionStart + SessionEnd definitions
    run-hook.cmd                              # Cross-platform polyglot wrapper
    session-start                             # Auto-pull hook (extensionless)
    session-end                               # Auto-push hook (extensionless)
  skills/
    start/SKILL.md                            # /any-sync:start
    pull/SKILL.md                             # /any-sync:pull
    push/SKILL.md                             # /any-sync:push
    status/SKILL.md                           # /any-sync:status
    reset/SKILL.md                            # /any-sync:reset
```

Each script has a single clear responsibility. Dependencies flow upward: `auth` and `lockfile` are utilities used by `pull`, `push`, `status`, and `init`. Hooks call scripts. Skills instruct Claude to call scripts.

---

## Task 1: Plugin Scaffold and Auth Script

**Files:**
- Create: `claude-plugin/.claude-plugin/plugin.json`
- Create: `claude-plugin/.gitattributes`
- Create: `claude-plugin/scripts/any-sync-auth.sh`

- [ ] **Step 1: Create plugin manifest**

```json
{
  "name": "any-sync",
  "description": "Cross-device sync for Claude skills, memory, settings, and custom files via GitHub",
  "version": "0.1.0",
  "author": {
    "name": "Any Sync Contributors"
  },
  "homepage": "https://github.com/imink/skills-sync-plugin",
  "repository": "https://github.com/imink/skills-sync-plugin",
  "license": "MIT",
  "keywords": ["sync", "skills", "memory", "github", "cross-device"]
}
```

Write to `claude-plugin/.claude-plugin/plugin.json`.

- [ ] **Step 2: Create .gitattributes**

```
hooks/session-start text eol=lf
hooks/session-end text eol=lf
hooks/run-hook.cmd text eol=lf
scripts/*.sh text eol=lf
```

Write to `claude-plugin/.gitattributes`.

- [ ] **Step 3: Write auth script**

Write `claude-plugin/scripts/any-sync-auth.sh`:

```bash
#!/bin/bash
# any-sync-auth.sh — Check GitHub authentication
# Output: prints token to stdout on success
# Exit: 0 if authenticated, 1 if not
#
# Priority: GITHUB_TOKEN env var → gh auth token

set -euo pipefail

# 1. Check GITHUB_TOKEN env var
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN"
  exit 0
fi

# 2. Try gh CLI auth
if command -v gh >/dev/null 2>&1; then
  TOKEN=$(gh auth token 2>/dev/null) || true
  if [ -n "${TOKEN:-}" ]; then
    echo "$TOKEN"
    exit 0
  fi
fi

# 3. No auth available
echo "Error: No GitHub authentication found." >&2
echo "" >&2
echo "Set up authentication using one of:" >&2
echo "  1. Set GITHUB_TOKEN environment variable" >&2
echo "  2. Run 'gh auth login' to authenticate with GitHub CLI" >&2
exit 1
```

- [ ] **Step 4: Make auth script executable and test**

Run:
```bash
chmod +x claude-plugin/scripts/any-sync-auth.sh
bash claude-plugin/scripts/any-sync-auth.sh
```
Expected: prints a token (if `gh` is authenticated) or shows the error message.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/.claude-plugin/plugin.json claude-plugin/.gitattributes claude-plugin/scripts/any-sync-auth.sh
git commit -m "feat(claude-plugin): scaffold plugin and add auth script"
```

---

## Task 2: Lockfile Utilities

**Files:**
- Create: `claude-plugin/scripts/any-sync-lockfile.sh`

**Reference:** The VS Code extension's lockfile implementation is in `src/sync/lockfile.ts`. Key format: `{mappingName}::{relativePath}`. Hash format: bare hex SHA-256. Structure: `{ "version": 1, "files": {...}, "lastSync": {...} }`.

- [ ] **Step 1: Write lockfile utility script**

Write `claude-plugin/scripts/any-sync-lockfile.sh`. This script is sourced by other scripts (not executed directly). It provides functions for lockfile operations.

```bash
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
```

- [ ] **Step 2: Write a test script for lockfile utilities**

Write `claude-plugin/scripts/test-lockfile.sh`:

```bash
#!/bin/bash
# Quick smoke test for lockfile utilities
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/any-sync-lockfile.sh"

TMPLOCK=$(mktemp /tmp/test-lockfile.XXXXXX)
trap 'rm -f "$TMPLOCK"' EXIT

# Test init with empty file
lockfile_init "$TMPLOCK"
echo "PASS: init empty"

# Test set entry
lockfile_set_entry "skills::readme.md" "abc123" "def456hash"
echo "PASS: set entry"

# Test get entry
ENTRY=$(lockfile_get_entry "skills::readme.md")
REMOTE=$(echo "$ENTRY" | jq -r '.remoteSha')
if [ "$REMOTE" = "abc123" ]; then
  echo "PASS: get entry remoteSha"
else
  echo "FAIL: expected abc123, got $REMOTE" >&2
  exit 1
fi

# Test save and reload
lockfile_save
lockfile_init "$TMPLOCK"
ENTRY2=$(lockfile_get_entry "skills::readme.md")
REMOTE2=$(echo "$ENTRY2" | jq -r '.remoteSha')
if [ "$REMOTE2" = "abc123" ]; then
  echo "PASS: save and reload"
else
  echo "FAIL: lost data after save/reload" >&2
  exit 1
fi

# Test last sync
lockfile_set_last_sync "skills"
LS=$(lockfile_get_last_sync "skills")
if [ "$LS" != "null" ]; then
  echo "PASS: last sync"
else
  echo "FAIL: last sync was null" >&2
  exit 1
fi

# Test hash_file
echo -n "hello" > "${TMPLOCK}.hashtest"
HASH=$(hash_file "${TMPLOCK}.hashtest")
rm -f "${TMPLOCK}.hashtest"
# SHA-256 of "hello" = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
if [ "$HASH" = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" ]; then
  echo "PASS: hash_file"
else
  echo "FAIL: hash mismatch: $HASH" >&2
  exit 1
fi

# Test make_key
KEY=$(lockfile_make_key "mymap" "path/to/file.md")
if [ "$KEY" = "mymap::path/to/file.md" ]; then
  echo "PASS: make_key"
else
  echo "FAIL: key=$KEY" >&2
  exit 1
fi

# Test get_entries_for_mapping
lockfile_set_entry "skills::file1.md" "sha1" "hash1"
lockfile_set_entry "skills::dir/file2.md" "sha2" "hash2"
lockfile_set_entry "memory::note.md" "sha3" "hash3"
ENTRIES=$(lockfile_get_entries_for_mapping "skills")
COUNT=$(echo "$ENTRIES" | jq 'length')
if [ "$COUNT" -ge 2 ]; then
  echo "PASS: get_entries_for_mapping"
else
  echo "FAIL: expected >= 2 entries, got $COUNT" >&2
  exit 1
fi

echo ""
echo "All lockfile tests passed."
```

- [ ] **Step 3: Run lockfile tests**

```bash
chmod +x claude-plugin/scripts/any-sync-lockfile.sh claude-plugin/scripts/test-lockfile.sh
bash claude-plugin/scripts/test-lockfile.sh
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add claude-plugin/scripts/any-sync-lockfile.sh claude-plugin/scripts/test-lockfile.sh
git commit -m "feat(claude-plugin): add lockfile utilities with tests"
```

---

## Task 3: Init and Reset Scripts

**Files:**
- Create: `claude-plugin/scripts/any-sync-init.sh`
- Create: `claude-plugin/scripts/any-sync-reset.sh`

- [ ] **Step 1: Write init script**

Write `claude-plugin/scripts/any-sync-init.sh`:

```bash
#!/bin/bash
# any-sync-init.sh — Create .any-sync.json config
# Usage: any-sync-init.sh <config-path> <repo> [branch]
# Output: prints config path on success
set -euo pipefail

CONFIG_PATH="${1:-}"
REPO="${2:-}"
BRANCH="${3:-main}"

if [ -z "$CONFIG_PATH" ] || [ -z "$REPO" ]; then
  echo "Usage: any-sync-init.sh <config-path> <repo> [branch]" >&2
  exit 1
fi

# Validate repo format (owner/repo)
if ! echo "$REPO" | grep -qE '^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$'; then
  echo "Error: Invalid repo format. Use owner/repo (e.g., myuser/my-sync-repo)" >&2
  exit 1
fi

# Check if config already exists
if [ -f "$CONFIG_PATH" ]; then
  echo "$CONFIG_PATH"
  exit 0
fi

# Create parent directory if needed
mkdir -p "$(dirname "$CONFIG_PATH")"

# Write default Claude mappings
cat > "$CONFIG_PATH" << INITEOF
{
  "mappings": [
    {
      "name": "claude-skills",
      "repo": "${REPO}",
      "branch": "${BRANCH}",
      "sourcePath": "skills",
      "destPath": "~/.claude/skills",
      "include": ["**/*.md"]
    },
    {
      "name": "claude-memory",
      "repo": "${REPO}",
      "branch": "${BRANCH}",
      "sourcePath": "memory",
      "destPath": "~/.claude/memory"
    },
    {
      "name": "claude-settings",
      "repo": "${REPO}",
      "branch": "${BRANCH}",
      "sourcePath": "settings",
      "destPath": "~/.claude",
      "include": ["settings.json"]
    }
  ]
}
INITEOF

echo "$CONFIG_PATH"
```

- [ ] **Step 2: Write reset script**

Write `claude-plugin/scripts/any-sync-reset.sh`:

```bash
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
```

- [ ] **Step 3: Test init and reset**

```bash
chmod +x claude-plugin/scripts/any-sync-init.sh claude-plugin/scripts/any-sync-reset.sh

# Test init
TMPCONF=$(mktemp /tmp/test-init-XXXXXX.json)
rm "$TMPCONF"  # Remove so init creates it
bash claude-plugin/scripts/any-sync-init.sh "$TMPCONF" "testuser/testrepo" "main"
cat "$TMPCONF"  # Should show valid JSON with 3 mappings
jq '.mappings | length' "$TMPCONF"  # Should print 3

# Test reset
bash claude-plugin/scripts/any-sync-reset.sh "$TMPCONF"
# Should show {"deletedConfig": true, ...}
test ! -f "$TMPCONF" && echo "PASS: config deleted" || echo "FAIL"
```

Expected: Config created with 3 mappings, then successfully deleted.

- [ ] **Step 4: Commit**

```bash
git add claude-plugin/scripts/any-sync-init.sh claude-plugin/scripts/any-sync-reset.sh
git commit -m "feat(claude-plugin): add init and reset scripts"
```

---

## Task 4: Status Script

**Files:**
- Create: `claude-plugin/scripts/any-sync-status.sh`

- [ ] **Step 1: Write status script**

Write `claude-plugin/scripts/any-sync-status.sh`:

```bash
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
```

- [ ] **Step 2: Test status script (with config, no lockfile)**

```bash
chmod +x claude-plugin/scripts/any-sync-status.sh

# Create a temp config
TMPCONF=$(mktemp /tmp/test-status-XXXXXX.json)
cat > "$TMPCONF" << 'EOF'
{"mappings":[{"name":"test","repo":"testuser/testrepo","branch":"main","sourcePath":"skills","destPath":"/tmp/test-dest"}]}
EOF

bash claude-plugin/scripts/any-sync-status.sh "$TMPCONF" "/tmp/test-status.lock"
rm -f "$TMPCONF" "/tmp/test-status.lock"
```

Expected: JSON output with auth info, config valid=true, mappings array with one entry.

- [ ] **Step 3: Commit**

```bash
git add claude-plugin/scripts/any-sync-status.sh
git commit -m "feat(claude-plugin): add status script"
```

---

## Task 5: Pull Script

**Files:**
- Create: `claude-plugin/scripts/any-sync-pull.sh`

**Reference:** Pull logic in spec lines 267-283. VS Code implementation in `src/sync/pullManager.ts`. GitHub API: Trees API (`/repos/{owner}/{repo}/git/trees/{branch}?recursive=1`), Blobs API (`/repos/{owner}/{repo}/git/blobs/{sha}`).

- [ ] **Step 1: Write pull script**

Write `claude-plugin/scripts/any-sync-pull.sh`:

```bash
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

# Ensure auth
TOKEN=$("${SCRIPT_DIR}/any-sync-auth.sh") || exit 1
export GITHUB_TOKEN="$TOKEN"

lockfile_init "$LOCKFILE_PATH"

PULLED="[]"
CONFLICTS="[]"
SKIPPED="[]"

MAPPING_COUNT=$(jq '.mappings | length' "$CONFIG_PATH")

for i in $(seq 0 $((MAPPING_COUNT - 1))); do
  NAME=$(jq -r ".mappings[$i].name" "$CONFIG_PATH")
  REPO=$(jq -r ".mappings[$i].repo" "$CONFIG_PATH")
  BRANCH=$(jq -r ".mappings[$i].branch // \"main\"" "$CONFIG_PATH")
  SOURCE_PATH=$(jq -r ".mappings[$i].sourcePath" "$CONFIG_PATH")
  DEST_PATH=$(jq -r ".mappings[$i].destPath" "$CONFIG_PATH")

  # Expand tilde
  DEST_PATH="${DEST_PATH/#\~/$HOME}"

  # Read include/exclude arrays
  INCLUDE_JSON=$(jq -c ".mappings[$i].include // []" "$CONFIG_PATH")
  EXCLUDE_JSON=$(jq -c ".mappings[$i].exclude // []" "$CONFIG_PATH")

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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x claude-plugin/scripts/any-sync-pull.sh
```

- [ ] **Step 3: Manual integration test**

Test against a real GitHub repo (the skills-sync-plugin repo itself):

```bash
# Create a test config pointing at this repo
TMPCONF=$(mktemp /tmp/test-pull-XXXXXX.json)
cat > "$TMPCONF" << 'EOF'
{"mappings":[{"name":"test-skills","repo":"imink/skills-sync-plugin","branch":"main","sourcePath":".claude/skills","destPath":"/tmp/any-sync-test-pull","include":["**/*.md"]}]}
EOF

TMPLOCK="/tmp/any-sync-test-pull.lock"
bash claude-plugin/scripts/any-sync-pull.sh "$TMPCONF" "$TMPLOCK"

# Verify files were pulled
ls -la /tmp/any-sync-test-pull/
cat "$TMPLOCK" | jq .

# Clean up
rm -rf /tmp/any-sync-test-pull "$TMPCONF" "$TMPLOCK"
```

Expected: Pulls `.md` files from `.claude/skills/` directory of the repo, creates lockfile with entries.

- [ ] **Step 4: Commit**

```bash
git add claude-plugin/scripts/any-sync-pull.sh
git commit -m "feat(claude-plugin): add pull script"
```

---

## Task 6: Push Script

**Files:**
- Create: `claude-plugin/scripts/any-sync-push.sh`

**Reference:** Push logic in spec lines 286-313. VS Code implementation in `src/sync/restPushFallback.ts`. API calls: create blob → create tree (with base_tree) → create commit → update ref (PATCH).

- [ ] **Step 1: Write push script**

Write `claude-plugin/scripts/any-sync-push.sh`:

```bash
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

# Ensure auth
TOKEN=$("${SCRIPT_DIR}/any-sync-auth.sh") || exit 1
export GITHUB_TOKEN="$TOKEN"

lockfile_init "$LOCKFILE_PATH"

ALL_PUSHED="[]"
LAST_BRANCH=""

MAPPING_COUNT=$(jq '.mappings | length' "$CONFIG_PATH")

for i in $(seq 0 $((MAPPING_COUNT - 1))); do
  NAME=$(jq -r ".mappings[$i].name" "$CONFIG_PATH")
  REPO=$(jq -r ".mappings[$i].repo" "$CONFIG_PATH")
  BRANCH=$(jq -r ".mappings[$i].branch // \"main\"" "$CONFIG_PATH")
  SOURCE_PATH=$(jq -r ".mappings[$i].sourcePath" "$CONFIG_PATH")
  DEST_PATH=$(jq -r ".mappings[$i].destPath" "$CONFIG_PATH")
  LAST_BRANCH="$BRANCH"

  # Expand tilde
  DEST_PATH="${DEST_PATH/#\~/$HOME}"

  if [ ! -d "$DEST_PATH" ]; then
    continue
  fi

  # Read include/exclude
  INCLUDE_JSON=$(jq -c ".mappings[$i].include // []" "$CONFIG_PATH")
  EXCLUDE_JSON=$(jq -c ".mappings[$i].exclude // []" "$CONFIG_PATH")

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
```

- [ ] **Step 2: Make executable**

```bash
chmod +x claude-plugin/scripts/any-sync-push.sh
```

- [ ] **Step 3: Commit**

Push should be tested manually against a test repo when doing integration testing (Task 11). Do not test against the real repo here.

```bash
git add claude-plugin/scripts/any-sync-push.sh
git commit -m "feat(claude-plugin): add push script (direct to branch)"
```

---

## Task 7: Cross-Platform Hook Wrapper

**Files:**
- Create: `claude-plugin/hooks/run-hook.cmd`

**Reference:** Superpowers plugin's `run-hook.cmd` at `~/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.5/hooks/run-hook.cmd`.

- [ ] **Step 1: Write polyglot wrapper**

Write `claude-plugin/hooks/run-hook.cmd` (copy the superpowers pattern, adapted for our plugin):

```cmd
: << 'CMDBLOCK'
@echo off
REM Cross-platform polyglot wrapper for hook scripts.
REM On Windows: cmd.exe runs the batch portion, which finds and calls bash.
REM On Unix: the shell interprets this as a script (: is a no-op in bash).
REM
REM Hook scripts use extensionless filenames (e.g. "session-start" not
REM "session-start.sh") so Claude Code's Windows auto-detection -- which
REM prepends "bash" to any command containing .sh -- doesn't interfere.
REM
REM Usage: run-hook.cmd <script-name> [args...]

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"

REM Try Git for Windows bash in standard locations
if exist "C:\Program Files\Git\bin\bash.exe" (
    "C:\Program Files\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)
if exist "C:\Program Files (x86)\Git\bin\bash.exe" (
    "C:\Program Files (x86)\Git\bin\bash.exe" "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM Try bash on PATH (e.g. user-installed Git Bash, MSYS2, Cygwin)
where bash >nul 2>nul
if %ERRORLEVEL% equ 0 (
    bash "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

REM No bash found - exit silently rather than error
exit /b 0
CMDBLOCK

# Unix: run the named script directly
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec bash "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
```

- [ ] **Step 2: Commit**

```bash
git add claude-plugin/hooks/run-hook.cmd
git commit -m "feat(claude-plugin): add cross-platform hook wrapper"
```

---

## Task 8: Session Hooks

**Files:**
- Create: `claude-plugin/hooks/hooks.json`
- Create: `claude-plugin/hooks/session-start`
- Create: `claude-plugin/hooks/session-end`

- [ ] **Step 1: Write hooks.json**

Write `claude-plugin/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-start",
            "async": true
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd\" session-end",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Write session-start hook**

Write `claude-plugin/hooks/session-start` (extensionless):

```bash
#!/bin/bash
# Auto-pull on session start if config exists and auth is available
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$HOME/.any-sync.json"
if [ ! -f "$CONFIG" ] && [ -f ".any-sync.json" ]; then
  CONFIG=".any-sync.json"
fi
if [ ! -f "$CONFIG" ]; then
  exit 0
fi

TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  exit 0
fi

LOCKFILE=".any-sync.lock"
RESULT=$("${SCRIPT_DIR}/scripts/any-sync-pull.sh" "$CONFIG" "$LOCKFILE" 2>/dev/null) || exit 0
PULL_COUNT=$(echo "$RESULT" | jq '.pulled | length' 2>/dev/null || echo "0")

if [ "$PULL_COUNT" -gt 0 ]; then
  printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "Any Sync: auto-pulled %s file(s) from GitHub. Use /any-sync:status for details."\n  }\n}\n' "$PULL_COUNT"
fi
```

- [ ] **Step 3: Write session-end hook**

Write `claude-plugin/hooks/session-end` (extensionless):

```bash
#!/bin/bash
# Auto-push local changes on session end (direct to branch, no confirmation)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$HOME/.any-sync.json"
if [ ! -f "$CONFIG" ] && [ -f ".any-sync.json" ]; then
  CONFIG=".any-sync.json"
fi
if [ ! -f "$CONFIG" ]; then
  exit 0
fi

TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  exit 0
fi

LOCKFILE=".any-sync.lock"
RESULT=$("${SCRIPT_DIR}/scripts/any-sync-status.sh" "$CONFIG" "$LOCKFILE" 2>/dev/null) || exit 0
HAS_CHANGES=$(echo "$RESULT" | jq '[.mappings[].changes | length] | add // 0' 2>/dev/null || echo "0")

if [ "$HAS_CHANGES" -gt 0 ]; then
  "${SCRIPT_DIR}/scripts/any-sync-push.sh" "$CONFIG" "$LOCKFILE" 2>/dev/null || true
fi
```

- [ ] **Step 4: Make hooks executable**

```bash
chmod +x claude-plugin/hooks/session-start claude-plugin/hooks/session-end
```

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/hooks/hooks.json claude-plugin/hooks/session-start claude-plugin/hooks/session-end
git commit -m "feat(claude-plugin): add session hooks (auto-pull/push)"
```

---

## Task 9: Skills (Slash Commands)

**Files:**
- Create: `claude-plugin/skills/start/SKILL.md`
- Create: `claude-plugin/skills/pull/SKILL.md`
- Create: `claude-plugin/skills/push/SKILL.md`
- Create: `claude-plugin/skills/status/SKILL.md`
- Create: `claude-plugin/skills/reset/SKILL.md`

- [ ] **Step 1: Write /any-sync:start skill**

Write `claude-plugin/skills/start/SKILL.md`:

````markdown
---
name: start
description: Initialize Any Sync config and run first pull — guided setup wizard
---

# Any Sync Setup Wizard

Guide the user through setting up Any Sync for cross-device sync.

## Steps

### 1. Check Authentication

Run the auth check:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-auth.sh"
```

If it fails (exit code 1), help the user set up authentication:
- Option A: Set `GITHUB_TOKEN` environment variable
- Option B: Run `gh auth login` to authenticate with GitHub CLI

Do not proceed until auth succeeds.

### 2. Get Sync Repo

Ask the user for their sync repo in `owner/repo` format. This is the GitHub repository where their Claude files will be stored.

If they don't have one yet, suggest they create a new private repo on GitHub first.

### 3. Create Config

Ask the user which items to sync (default: all three):
- Skills (`~/.claude/skills`)
- Memory (`~/.claude/memory`)
- Settings (`~/.claude/settings.json`)

Then run the init script:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-init.sh" "$HOME/.any-sync.json" "<owner/repo>" "<branch>"
```

Use `main` as the default branch unless the user specifies otherwise.

### 4. First Pull

Run the first pull to download existing files:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-pull.sh" "$HOME/.any-sync.json" ".any-sync.lock"
```

### 5. Show Summary

Parse the JSON output and display what was synced in a readable format:
- Number of files pulled per mapping
- Any conflicts found
- Config file location
````

- [ ] **Step 2: Write /any-sync:pull skill**

Write `claude-plugin/skills/pull/SKILL.md`:

````markdown
---
name: pull
description: Pull latest files from GitHub sync repo
---

# Pull from GitHub

Pull the latest files from the configured GitHub sync repo.

## Steps

### 1. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory. If neither exists, tell the user to run `/any-sync:start` first.

### 2. Run Pull

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-pull.sh" "<config-path>" ".any-sync.lock"
```

### 3. Report Results

Parse the JSON output and report:
- **Pulled:** List each file that was downloaded
- **Conflicts:** List each file where both local and remote changed
- **Skipped:** Count of unchanged files

### 4. Resolve Conflicts

If there are conflicts, for each conflicted file ask the user:
- **Keep local** — skip this file (local changes preserved)
- **Take remote** — download the remote version (local changes overwritten)
- **Skip** — do nothing for now

If the user chooses "Take remote" for a conflict, download that specific file by running pull again after clearing the lockfile entry for that file. Alternatively, you can manually download the blob and update the lockfile.
````

- [ ] **Step 3: Write /any-sync:push skill**

Write `claude-plugin/skills/push/SKILL.md`:

````markdown
---
name: push
description: Push local changes directly to configured branch on GitHub
---

# Push to GitHub

Push local changes directly to the configured branch on GitHub.

## Steps

### 1. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory. If neither exists, tell the user to run `/any-sync:start` first.

### 2. Check for Changes

Run the status script to see what has changed:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-status.sh" "<config-path>" ".any-sync.lock"
```

Show the user which files have changed (modified or new) across all mappings.

### 3. Confirm Push

Ask the user to confirm before pushing. Show:
- Which files will be pushed
- Which branch they will be pushed to
- Which repo they will be pushed to

### 4. Run Push

If confirmed:
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-push.sh" "<config-path>" ".any-sync.lock"
```

### 5. Report Results

Parse the JSON output and report:
- Files pushed
- Branch updated
- Any errors encountered
````

- [ ] **Step 4: Write /any-sync:status skill**

Write `claude-plugin/skills/status/SKILL.md`:

````markdown
---
name: status
description: Show sync status — auth, config, last sync, pending changes
---

# Sync Status

Show the current sync status.

## Steps

### 1. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory. If neither exists, tell the user to run `/any-sync:start` first.

### 2. Run Status

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-status.sh" "<config-path>" ".any-sync.lock"
```

### 3. Display Results

Parse the JSON output and display in a readable format:

- **Authentication:** method (token/gh/none) and GitHub username
- **Config:** path and validity
- **Per mapping:**
  - Name and repo
  - Last sync time (relative, e.g., "2 hours ago")
  - Number of tracked files
  - Pending changes (list modified and new files)
````

- [ ] **Step 5: Write /any-sync:reset skill**

Write `claude-plugin/skills/reset/SKILL.md`:

````markdown
---
name: reset
description: Clear Any Sync config and delete lockfile
---

# Reset Any Sync

Clear the Any Sync config and lockfile.

## Steps

### 1. Confirm Reset

Ask the user to confirm they want to reset. Explain that this will:
- Delete the config file (`.any-sync.json`)
- Delete the lockfile (`.any-sync.lock`)
- NOT delete any synced files (skills, memory, settings remain on disk)

### 2. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory.

### 3. Run Reset

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-reset.sh" "<config-path>" ".any-sync.lock"
```

### 4. Report Results

Parse the JSON output and report what was cleared.
````

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/skills/
git commit -m "feat(claude-plugin): add all 5 skill definitions"
```

---

## Task 10: Add Retry Wrapper Test

**Files:**
- Modify: `claude-plugin/scripts/test-lockfile.sh`

- [ ] **Step 1: Extend test script to verify gh_api_retry function**

Add a test to `claude-plugin/scripts/test-lockfile.sh` that verifies `gh_api_retry` is callable (it requires `gh` and a network, so just verify the function exists and can be invoked with a known-good endpoint):

```bash
# Add at the end of test-lockfile.sh, before "All lockfile tests passed":

# Test gh_api_retry is available
type gh_api_retry >/dev/null 2>&1 && echo "PASS: gh_api_retry function exists" || {
  echo "FAIL: gh_api_retry not defined" >&2
  exit 1
}
```

- [ ] **Step 2: Run tests**

```bash
bash claude-plugin/scripts/test-lockfile.sh
```

Expected: All tests pass including the new gh_api_retry check.

- [ ] **Step 3: Commit**

```bash
git add claude-plugin/scripts/test-lockfile.sh
git commit -m "test(claude-plugin): add gh_api_retry function check"
```

---

## Task 11: Integration Testing

**Files:** None (manual testing)

- [ ] **Step 1: Verify plugin structure**

```bash
find claude-plugin -type f | sort
```

Verify the output matches the file structure from the spec.

- [ ] **Step 2: Test auth script**

```bash
bash claude-plugin/scripts/any-sync-auth.sh && echo "AUTH OK" || echo "AUTH FAILED"
```

- [ ] **Step 3: Test init → pull → push cycle**

This requires a test GitHub repo with write access. Use a personal test repo:

```bash
# Init
bash claude-plugin/scripts/any-sync-init.sh "/tmp/test-any-sync.json" "<your-test-repo>" "main"

# Pull
bash claude-plugin/scripts/any-sync-pull.sh "/tmp/test-any-sync.json" "/tmp/test-any-sync.lock"

# Modify a pulled file (add a comment)
echo "# test change" >> ~/.claude/skills/some-file.md  # adjust path as needed

# Status
bash claude-plugin/scripts/any-sync-status.sh "/tmp/test-any-sync.json" "/tmp/test-any-sync.lock"

# Push
bash claude-plugin/scripts/any-sync-push.sh "/tmp/test-any-sync.json" "/tmp/test-any-sync.lock"

# Verify on GitHub that the commit appears

# Reset
bash claude-plugin/scripts/any-sync-reset.sh "/tmp/test-any-sync.json" "/tmp/test-any-sync.lock"
```

- [ ] **Step 4: Test hooks wrapper**

```bash
bash claude-plugin/hooks/run-hook.cmd session-start
```

Expected: Runs the session-start hook (may pull or skip silently if no config).

- [ ] **Step 5: Verify all scripts are executable**

```bash
ls -la claude-plugin/scripts/*.sh claude-plugin/hooks/session-start claude-plugin/hooks/session-end
```

All should have executable permission (`-rwxr-xr-x`).

---

## Task 12: Final Commit and Summary

- [ ] **Step 1: Review all changes**

```bash
git log --oneline | head -20
git diff --stat HEAD~10  # Adjust count based on number of commits
```

- [ ] **Step 2: Verify no changes to existing VS Code extension**

```bash
git diff HEAD~10 -- src/ package.json schemas/ esbuild.js tsconfig.json
```

Expected: No changes to any existing files.

- [ ] **Step 3: Summary**

The Claude Code plugin is complete with:
- Plugin manifest and .gitattributes
- 7 shell scripts (auth, lockfile, init, reset, status, pull, push)
- 3 hook files (hooks.json, session-start, session-end)
- 1 cross-platform wrapper (run-hook.cmd)
- 5 skills (start, pull, push, status, reset)
