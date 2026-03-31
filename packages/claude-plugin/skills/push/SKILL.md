---
name: push
description: Push local changes directly to configured branch on GitHub
---

# Push to GitHub

Push local changes directly to the configured branch on GitHub.

Resolve the shared scripts path:
```bash
SHARED_SCRIPTS="${CLAUDE_PLUGIN_ROOT}/../shared-scripts"
```

## Steps

### 1. Find Config

Look for config at `$HOME/.any-sync.json` first, then `.any-sync.json` in the current directory. If neither exists, tell the user to run `/any-sync:start` first.

### 2. Check for Changes

Run the status script to see what has changed:
```bash
bash "${SHARED_SCRIPTS}/any-sync-status.sh" "<config-path>" ".any-sync.lock"
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
bash "${SHARED_SCRIPTS}/any-sync-push.sh" "<config-path>" ".any-sync.lock"
```

### 5. Report Results

Parse the JSON output and report:
- Files pushed
- Branch updated
- Any errors encountered
