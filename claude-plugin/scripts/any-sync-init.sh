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
