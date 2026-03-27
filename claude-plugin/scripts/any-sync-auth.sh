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
