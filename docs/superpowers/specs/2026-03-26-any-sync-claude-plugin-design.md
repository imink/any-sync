# Any Sync — Claude Code Plugin Design

**Date:** 2026-03-26
**Updated:** 2026-03-27
**Status:** Approved
**Project:** skills-sync-plugin (monorepo)

---

## Problem

The existing Any Sync VS Code extension enables cross-device sync of Claude skills, memory, and config via GitHub. However, it only works inside VS Code. Users who work in the Claude Code CLI have no way to sync their skills, memory, settings, or custom files across devices.

## Goal

Add a Claude Code plugin to the existing skills-sync-plugin monorepo that provides the same sync capabilities directly inside Claude Code, using the same config format and lockfile as the VS Code extension.

## Constraints

1. **No changes to the existing VS Code extension** — current TypeScript/Octokit implementation stays untouched.
2. **Same 5 commands on both platforms:** `start`, `pull`, `push`, `status` (output), `reset` (clear auth + config).
3. **Compatible config format** (`.any-sync.json`) and **identical lockfile format** (`.any-sync.lock`).
4. **GitHub as sync backend** — uses `GITHUB_TOKEN` env var with `gh` CLI fallback for auth.

---

## Architecture

### Overview

The monorepo gains a new `claude-plugin/` directory that is a self-contained Claude Code plugin. It contains skills (slash commands), hooks, and shell scripts for sync logic.

The VS Code extension continues using its TypeScript/Octokit implementation unchanged. The Claude plugin uses shell scripts that call `gh` CLI. Both read/write the same `.any-sync.lock` lockfile format so sync state is interoperable.

### Repo Structure

```
skills-sync-plugin/
  # ──── Existing VS Code Extension (unchanged) ────
  src/                          # TypeScript source
  out/                          # Compiled extension output
  package.json                  # VS Code extension manifest
  esbuild.js                   # Build script
  schemas/                     # JSON Schema for config
  assets/                      # Logo, icons
  tsconfig.json
  .eslintrc.json
  .prettierrc

  # ──── New: Claude Code Plugin (self-contained) ────
  claude-plugin/
    .claude-plugin/
      plugin.json               # Plugin metadata
    skills/
      start/
        SKILL.md                # /any-sync:start — guided init + first pull
      pull/
        SKILL.md                # /any-sync:pull — pull from GitHub
      push/
        SKILL.md                # /any-sync:push — push to GitHub (direct to branch)
      status/
        SKILL.md                # /any-sync:status — show sync state
      reset/
        SKILL.md                # /any-sync:reset — clear auth + config
    hooks/
      hooks.json                # Hook definitions (SessionStart, SessionEnd)
      session-start             # Auto-pull hook script (extensionless for Windows compat)
      session-end               # Auto-push hook script (extensionless for Windows compat)
      run-hook.cmd              # Cross-platform polyglot wrapper (bash + cmd)
    scripts/
      any-sync-pull.sh          # Core pull logic
      any-sync-push.sh          # Core push logic (direct to branch)
      any-sync-status.sh        # Show sync state
      any-sync-init.sh          # Create/validate config
      any-sync-reset.sh         # Clear config + delete lockfile
      any-sync-auth.sh          # Auth check (GITHUB_TOKEN → gh fallback)
      any-sync-lockfile.sh      # Lockfile read/write/compare utilities
    .gitattributes              # Enforce LF line endings for all scripts
```

All scripts live inside `claude-plugin/scripts/` so the plugin is fully self-contained and can be distributed by copying the `claude-plugin/` directory alone.

---

## Plugin Manifest

### `.claude-plugin/plugin.json`

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

---

## Commands

Both platforms expose the same 5 commands:

| Command | VS Code Command ID | Claude Slash Command | Description |
|---------|--------------------|---------------------|-------------|
| **start** | `any-sync.initOrEditConfig` | `/any-sync:start` | Guided wizard: check auth → init config → first pull |
| **pull** | `any-sync.pull` | `/any-sync:pull` | Pull all mappings from GitHub |
| **push** | `any-sync.push` | `/any-sync:push` | Push local changes directly to configured branch |
| **status** | `any-sync.showOutput` | `/any-sync:status` | Show sync state, last sync time, pending changes |
| **reset** | `any-sync.resetConfigAndAuth` | `/any-sync:reset` | Clear config and delete lockfile |

VS Code also retains its `pullSelect` and `pushSelect` commands for multi-select QuickPick. The Claude plugin handles selection interactively via the skill instructions (Claude asks the user which mappings to sync).

---

## Config Format

### Existing VS Code format (unchanged)

The VS Code extension uses per-mapping `repo` and `branch` fields. The config is stored in VS Code's extension global storage (not in the workspace root). The schema is:

```json
{
  "mappings": [
    {
      "name": "claude-skills",
      "repo": "owner/repo-name",
      "branch": "main",
      "sourcePath": "skills",
      "destPath": "~/.claude/skills",
      "include": ["**/*.md"],
      "exclude": []
    }
  ]
}
```

Valid mapping fields: `name` (required), `repo` (required), `branch` (optional, defaults to `main`), `sourcePath` (required), `destPath` (required), `include` (optional), `exclude` (optional). No other fields are allowed (`additionalProperties: false`).

### Claude plugin config

The Claude plugin uses the **exact same JSON schema** as the VS Code extension — per-mapping `repo` and `branch`, no top-level `repo`/`branch`, no `direction` field.

**Config location difference:** The VS Code extension stores config in its extension global storage directory (keyed by a SHA1 hash of the workspace URI). The Claude plugin stores config at:
1. `~/.any-sync.json` (global, checked first)
2. `.any-sync.json` in the current working directory (workspace-level)

These are **separate config files** on each platform. Users configure each platform independently. The lockfile is shared (see below).

### Path tokens

- `~` → user home directory
- `${copilotMemory}` → platform-specific VS Code Copilot memory location (VS Code extension only, not supported in Claude plugin)

### Default Claude mappings (created by `/any-sync:start`)

```json
{
  "mappings": [
    {
      "name": "claude-skills",
      "repo": "owner/repo-name",
      "branch": "main",
      "sourcePath": "skills",
      "destPath": "~/.claude/skills",
      "include": ["**/*.md"]
    },
    {
      "name": "claude-memory",
      "repo": "owner/repo-name",
      "branch": "main",
      "sourcePath": "memory",
      "destPath": "~/.claude/memory"
    },
    {
      "name": "claude-settings",
      "repo": "owner/repo-name",
      "branch": "main",
      "sourcePath": "settings",
      "destPath": "~/.claude",
      "include": ["settings.json"]
    }
  ]
}
```

---

## Lockfile Format

Both platforms share the **identical** `.any-sync.lock` format (JSON):

```json
{
  "version": 1,
  "files": {
    "claude-skills::path/to/file.md": {
      "remoteSha": "abc123def456...",
      "localHash": "41e8f9a26dea3c6622b6d9cffb6fe26763a283e14209453bd21137cbd2c02583",
      "syncedAt": "2026-03-26T10:00:00.000Z"
    }
  },
  "lastSync": {
    "claude-skills": "2026-03-26T10:00:00.000Z"
  }
}
```

**Key format:** `{mappingName}::{relativePath}`

**`localHash` format:** Bare hex SHA-256 string (no `sha256:` prefix). This matches the existing VS Code extension's `hashContent()` implementation in `lockfile.ts`.

**Location:** `.any-sync.lock` in the current working directory (workspace root). Both platforms read/write to the same file, enabling shared sync state.

---

## Authentication

The VS Code extension and Claude plugin use **separate auth mechanisms** — there is no shared auth state between them.

**VS Code extension:** Uses VS Code's built-in GitHub OAuth, with `GITHUB_TOKEN` env var fallback.

**Claude plugin priority order:**
1. `GITHUB_TOKEN` environment variable
2. `gh auth token` (GitHub CLI)
3. If neither available, guide user to set up auth

**Auth check script (`any-sync-auth.sh`):**
```
1. If $GITHUB_TOKEN is set and non-empty → echo it, exit 0
2. Else if `gh auth token` succeeds → echo the token, exit 0
3. Else → print error message with setup instructions, exit 1
```

---

## Sync Logic (Shell Scripts)

### Dependencies

Required:
- `gh` (GitHub CLI) — for all GitHub API calls
- `bash` (4.0+) — for script execution
- Standard POSIX utilities: `sha256sum` or `shasum`, `base64`, `mktemp`, `mv`

Not required:
- `jq` — scripts use `gh api --jq` for JSON parsing (built into `gh`)
- `git` — not needed (all operations use GitHub REST API via `gh api`)
- `node` — not needed

### Pull (`any-sync-pull.sh`)

```
Input: config path, lockfile path
For each mapping in config:
  1. Fetch repo tree via `gh api /repos/{owner}/{repo}/git/trees/{branch}?recursive=1`
  2. Filter tree entries by sourcePath prefix + include/exclude globs
  3. For each file:
     a. Read lockfile entry for this file
     b. If remoteSha unchanged → skip
     c. If remoteSha changed AND localHash changed → conflict (report, skip)
     d. If remoteSha changed AND localHash unchanged → download
  4. Download changed blobs via `gh api /repos/{owner}/{repo}/git/blobs/{sha}`
  5. Decode base64 content, write to destPath atomically (write to tmp file, then mv)
  6. Update lockfile entry with new remoteSha and localHash (bare hex SHA-256)
  7. Save lockfile
Output: JSON summary { "pulled": [...], "conflicts": [...], "skipped": [...] }
```

### Push (`any-sync-push.sh`)

Push goes **directly to the configured branch** (default `main`). No PR creation, no temporary branch.

```
Input: config path, lockfile path
For each mapping:
  1. Scan destPath for files matching include/exclude
  2. Hash each file (SHA-256, bare hex)
  3. Compare against lockfile localHash → detect changed files
  4. Also detect new files (not in lockfile)
  5. If no changes → skip
  6. For each changed/new file:
     a. Create blob via `gh api /repos/{owner}/{repo}/git/blobs`
     b. Build tree entries
  7. Get current commit SHA via `gh api /repos/{owner}/{repo}/git/ref/heads/{branch}`
  8. Get base tree SHA from the commit
  9. Create new tree via `gh api /repos/{owner}/{repo}/git/trees`
  10. Create commit via `gh api /repos/{owner}/{repo}/git/commits`
  11. Update branch ref via `gh api -X PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`
  12. Update lockfile with new remoteSha and localHash
Output: JSON summary { "pushed": [...], "branch": "main" }

Error handling between steps:
- If blob creation fails → abort, report which file failed
- If tree/commit creation fails → abort, no partial state
- If ref update fails (e.g., concurrent push) → report error, suggest re-pull first
```

### Status (`any-sync-status.sh`)

```
Input: config path, lockfile path
Output: JSON
  - auth: { method: "token"|"gh"|"none", user: "..." }
  - config: { path: "...", valid: true|false }
  - mappings: [
      { name, repo, lastSync, trackedFiles, changes: [...] }
    ]
```

### Init (`any-sync-init.sh`)

```
Input: target config path, repo (owner/repo), branch
1. If config already exists → print location, exit 0
2. Create config with provided repo/branch and default Claude mappings
3. Validate config against schema rules
4. Write .any-sync.json
Output: config path
```

### Reset (`any-sync-reset.sh`)

```
Input: config path, lockfile path
1. Delete config file if exists
2. Delete lockfile if exists
3. Report what was cleared
Output: confirmation message
```

### Known Limitations

- **File deletions are not synced.** If a file is deleted from the GitHub repo, pull will not download it but will not delete the local copy. If a local file is deleted, push will not propagate the deletion. This matches the VS Code extension's current behavior.
- **Binary files** are supported (base64 encoded by GitHub API) but large files may hit API size limits.

---

## Skills (Slash Commands)

### `/any-sync:start` (Guided Wizard)

```markdown
---
name: start
description: Initialize Any Sync config and run first pull — guided setup wizard
---

Guide the user through setting up Any Sync:

1. Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-auth.sh` to check authentication
   - If auth fails, help the user set up GITHUB_TOKEN or gh CLI auth
2. Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-init.sh` to create config
   - Ask the user for their sync repo (owner/repo)
   - Ask which items to sync (skills, memory, settings, custom)
   - Create .any-sync.json
3. Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-pull.sh` for first pull
4. Show summary of what was synced
```

### `/any-sync:pull`

```markdown
---
name: pull
description: Pull latest files from GitHub sync repo
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-pull.sh` with the current config.
Report results: files pulled, conflicts found, files skipped.
If conflicts exist, ask the user how to resolve each one (keep local / take remote / skip).
```

### `/any-sync:push`

```markdown
---
name: push
description: Push local changes directly to configured branch on GitHub
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-push.sh` with the current config.
Show the user which files have changed before pushing.
Ask for confirmation before pushing.
Report the branch and files pushed when done.
```

### `/any-sync:status`

```markdown
---
name: status
description: Show sync status — auth, config, last sync, pending changes
---

Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-status.sh` with the current config.
Display results in a readable format.
```

### `/any-sync:reset`

```markdown
---
name: reset
description: Clear Any Sync config and delete lockfile
---

Ask for confirmation before resetting.
Run `${CLAUDE_PLUGIN_ROOT}/scripts/any-sync-reset.sh`.
Report what was cleared.
```

---

## Hooks

### `hooks.json`

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

The `SessionStart` matcher `startup|clear|compact` matches the superpowers plugin pattern and fires on session start, clear, and compact events.

Hook commands go through `run-hook.cmd` (the polyglot wrapper) instead of invoking hook scripts directly, ensuring Windows compatibility.

### `session-start` (Hook Script — extensionless)

```bash
#!/bin/bash
# Auto-pull on session start if config exists and auth is available
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$HOME/.any-sync.json"
if [ ! -f "$CONFIG" ] && [ -f ".any-sync.json" ]; then
  CONFIG=".any-sync.json"
fi
if [ ! -f "$CONFIG" ]; then
  exit 0  # No config, skip silently
fi

# Check auth silently
TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
if [ -z "$TOKEN" ]; then
  exit 0  # No auth, skip silently
fi

# Run pull
RESULT=$("${SCRIPT_DIR}/scripts/any-sync-pull.sh" "$CONFIG" 2>/dev/null)
PULL_COUNT=$(echo "$RESULT" | grep -o '"pulled"' | wc -l 2>/dev/null || echo "0")

# Output context for Claude using printf (avoids bash 5.3+ heredoc bug)
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "Any Sync: auto-pulled %s file(s) from GitHub. Use /any-sync:status for details."\n  }\n}\n' "$PULL_COUNT"
```

### `session-end` (Hook Script — extensionless)

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

# Check for changes and push if found
RESULT=$("${SCRIPT_DIR}/scripts/any-sync-status.sh" "$CONFIG" 2>/dev/null)
HAS_CHANGES=$(echo "$RESULT" | grep -c '"changes"' 2>/dev/null || echo "0")

if [ "$HAS_CHANGES" -gt 0 ]; then
  "${SCRIPT_DIR}/scripts/any-sync-push.sh" "$CONFIG" 2>/dev/null
fi
```

**Note:** The `session-end` hook pushes automatically without user confirmation. This is intentional — on session end there is no interactive prompt available, and push goes directly to the configured branch. Users who don't want auto-push can disable the hook. The interactive `/any-sync:push` skill always asks for confirmation.

### `run-hook.cmd` (Cross-Platform Polyglot Wrapper)

A polyglot script valid as both CMD batch and bash. Follows the superpowers plugin pattern:

- **On Windows (CMD.exe):** Searches for bash in Git for Windows paths (`C:\Program Files\Git\bin\bash.exe`, then PATH). Invokes the named hook script via bash. If no bash found, exits silently (graceful degradation).
- **On Unix (bash):** The CMD block is consumed by a heredoc no-op. Executes the named hook script directly via `exec bash`.

Hook scripts are **extensionless** (`session-start`, not `session-start.sh`) because Claude Code on Windows auto-prepends `bash` to `.sh` commands, which would interfere with the polyglot wrapper pattern.

### `.gitattributes`

Enforces LF line endings for all plugin files to prevent CRLF issues on Windows:

```
hooks/session-start text eol=lf
hooks/session-end text eol=lf
hooks/run-hook.cmd text eol=lf
scripts/*.sh text eol=lf
```

---

## Error Handling

- **No auth:** Skills guide user through setup. Hooks fail silently (no auth = no sync).
- **No config:** `/any-sync:start` creates one. Other commands report "no config found, run /any-sync:start".
- **Network errors:** Shell scripts retry up to 3 times with exponential backoff (1s, 2s, 4s).
- **Conflicts (pull):** Reported to user via skill. Claude helps resolve interactively (keep local / take remote / skip).
- **Rate limits:** `gh api` handles rate limiting automatically (built-in retry).
- **Missing `gh` CLI:** Error with setup instructions. `gh` is required — no `curl` fallback to avoid reimplementing the full Git Data API.
- **Push ref update fails:** If blob/tree/commit creation fails, abort cleanly. If ref update fails (concurrent push), report error and suggest re-pull.
- **No bash on Windows:** Hooks exit silently via `run-hook.cmd` graceful degradation. Skills require bash (Git for Windows).

---

## Distribution

The Claude plugin is self-contained in the `claude-plugin/` directory. Users install it by:

1. **Direct path:** Add the `claude-plugin/` directory path to `pluginSources` in their Claude Code `settings.json`
2. **GitHub marketplace:** Register on a Claude Code plugin marketplace with a `marketplace.json`
3. **Manual copy:** Copy the `claude-plugin/` directory to a local path and reference it

---

## Testing Strategy

- **Shell scripts:** Unit-testable independently. Mock `gh api` responses by creating a wrapper script that intercepts calls and returns fixture data.
- **Skills:** Manual testing via Claude Code CLI.
- **Hooks:** Test by starting/ending Claude Code sessions with config present.
- **Integration:** End-to-end test with a test GitHub repo (pull → modify → push → verify changes on branch).

---

## VS Code Extension Interactions

### What is shared between platforms
- **Lockfile format and location** (`.any-sync.lock` in workspace root) — enables cross-platform sync state
- **Config schema** (same JSON structure with per-mapping `repo`/`branch`)

### What is NOT shared between platforms
- **Config file location** — VS Code stores in extension global storage; Claude plugin stores at `~/.any-sync.json` or workspace root
- **Auth state** — VS Code uses its OAuth; Claude plugin uses `GITHUB_TOKEN` / `gh` CLI
- **The `syncRepoUrl` VS Code setting** — not supported in Claude plugin (each mapping has its own `repo`)
- **The `${copilotMemory}` path token** — VS Code only
- **The `applyRemoteConfigAsDefault` behavior** — VS Code only (auto-merges remote config)
- **Push mode** — VS Code creates PRs; Claude plugin pushes directly to branch

### Migration from legacy lockfile

The VS Code extension previously used `.github-sync.lock` as the lockfile name. The current code uses `.any-sync.lock`. The Claude plugin only reads `.any-sync.lock`. If a workspace has a legacy `.github-sync.lock`, the VS Code extension handles migration — the Claude plugin does not need to.

---

## Future Considerations

- **FileChanged hook:** Watch synced files for live change detection
- **Selective sync in Claude:** Interactive mapping selection (similar to VS Code's `pullSelect`/`pushSelect`)
- **Conflict resolution in Claude:** Side-by-side diff display using Claude's markdown output
- **File deletion sync:** Track deletions in the lockfile and propagate them
- **PR mode:** Optional flag to create PRs instead of direct push
- **VS Code extension refactor:** Optionally migrate VS Code extension to use the same shell scripts
- **Non-GitHub backends:** Abstract the sync backend to support GitLab, Bitbucket, or custom servers
