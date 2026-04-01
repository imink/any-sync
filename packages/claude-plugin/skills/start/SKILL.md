---
name: start
description: Initialize Any Sync config and run first pull — guided setup wizard
---

# Any Sync Setup Wizard

Guide the user through setting up Any Sync for cross-device sync.

Resolve the shared scripts path:
```
SCRIPTS="${CLAUDE_PLUGIN_ROOT}/scripts"
```

## Steps

### 1. Check Authentication

Run the auth check:
```bash
node "${SCRIPTS}/auth.js"
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

Then run the init script (this is plugin-specific, not shared):
```bash
node "${SCRIPTS}/init.js" "$HOME/.any-sync.json" "<owner/repo>" "<branch>"
```

Use `main` as the default branch unless the user specifies otherwise.

### 4. First Pull

Run the first pull to download existing files:
```bash
node "${SCRIPTS}/pull.js" "$HOME/.any-sync.json" ".any-sync.lock"
```

### 5. Show Summary

Parse the JSON output and display what was synced in a readable format:
- Number of files pulled per mapping
- Any conflicts found
- Config file location
