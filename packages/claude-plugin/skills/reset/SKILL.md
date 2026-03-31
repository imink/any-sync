---
name: reset
description: Clear Any Sync config and delete lockfile
---

# Reset Any Sync

Clear the Any Sync config and lockfile.

Resolve the shared scripts path:
```bash
SHARED_SCRIPTS="${CLAUDE_PLUGIN_ROOT}/scripts"
```

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
bash "${SHARED_SCRIPTS}/any-sync-reset.sh" "<config-path>" ".any-sync.lock"
```

### 4. Report Results

Parse the JSON output and report what was cleared.
