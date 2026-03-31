#!/bin/bash
# any-sync-init.sh — Create .any-sync.json config for OpenClaw workspace
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

# Validate branch name (alphanumeric, hyphens, underscores, dots, slashes)
if ! echo "$BRANCH" | grep -qE '^[a-zA-Z0-9._/-]+$'; then
  echo "Error: Invalid branch name. Use alphanumeric characters, hyphens, underscores, dots, or slashes." >&2
  exit 1
fi

# Check if config already exists
if [ -f "$CONFIG_PATH" ]; then
  echo "$CONFIG_PATH"
  exit 0
fi

# Create parent directory if needed
mkdir -p "$(dirname "$CONFIG_PATH")"

# Resolve OpenClaw workspace path
OPENCLAW_WORKSPACE="${OPENCLAW_WORKSPACE:-${HOME}/.openclaw/workspace}"
if [ -n "${OPENCLAW_PROFILE:-}" ] && [ "${OPENCLAW_PROFILE}" != "default" ]; then
  OPENCLAW_WORKSPACE="${HOME}/.openclaw/workspace-${OPENCLAW_PROFILE}"
fi

# Write default OpenClaw workspace mappings using jq for safe JSON construction
jq -n \
  --arg repo "$REPO" \
  --arg branch "$BRANCH" \
  --arg ws "$OPENCLAW_WORKSPACE" \
  '{
    mappings: [
      {name: "workspace-skills", repo: $repo, branch: $branch, sourcePath: "skills", destPath: ($ws + "/skills")},
      {name: "workspace-memory", repo: $repo, branch: $branch, sourcePath: "memory", destPath: ($ws + "/memory")},
      {name: "workspace-config", repo: $repo, branch: $branch, sourcePath: "config", destPath: $ws, include: ["AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md"]}
    ]
  }' > "$CONFIG_PATH"

echo "$CONFIG_PATH"
