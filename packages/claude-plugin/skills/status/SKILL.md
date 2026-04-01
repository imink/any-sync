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
npx any-sync status "<config-path>" ".any-sync.lock"
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
