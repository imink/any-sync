# Any Sync

![Any Sync Logo](packages/vscode-extension/assets/logo.png)

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/patrickw1029.any-sync?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync)

## Summary

Any Sync provides bidirectional sync between GitHub repositories and local directories. Pull files from any GitHub repo folder to your local workspace, and push changes back directly.

This monorepo contains two packages:

| Package | Path | Description |
|---------|------|-------------|
| **VS Code Extension** | `packages/vscode-extension` | Full-featured VS Code extension with UI, conflict resolution, and status bar |
| **Claude Code Plugin** | `packages/claude-plugin` | Shell-based plugin for Claude Code with slash commands and automatic session hooks |

Both share the same config format (`.any-sync.json`) and lockfile (`.any-sync.lock`), so you can use either tool interchangeably.

## How to Use

### VS Code Extension

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync), or build locally (see [Publishing](#publishing-the-vs-code-extension)).
2. Open a workspace folder.
3. Run **"Any Sync: Init or Edit Config"** from the Command Palette (`Cmd+Shift+P`).
4. Edit your mappings in `.any-sync.json`:
   ```json
   {
     "mappings": [
       {
         "name": "My Skills",
         "repo": "username/my-repo",
         "branch": "main",
         "sourcePath": "src",
         "destPath": "local/dest",
         "include": ["**/*.md"],
         "exclude": ["**/drafts/**"]
       }
     ]
   }
   ```
5. Run **"Any Sync: Pull"** to sync files.

#### Mapping Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable name for this mapping |
| `repo` | Yes | GitHub repo in `owner/repo` format |
| `branch` | | Branch to sync from/push to (default: `main`) |
| `sourcePath` | Yes | Path within the repo to sync from |
| `destPath` | Yes | Local destination (relative to workspace root, or absolute) |
| `include` | | Glob patterns to include (default: all files) |
| `exclude` | | Glob patterns to exclude |

#### Path Tokens

Use tokens in `destPath` for cross-device mappings:

| Token | Resolves to |
|-------|-------------|
| `${copilotMemory}` | VS Code Copilot memory folder on the current OS |

#### Authentication

The extension uses VS Code's built-in GitHub authentication. On first run, VS Code will prompt you to sign in. Alternatively, set the `GITHUB_TOKEN` environment variable for headless/CI scenarios.

#### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `any-sync.logLevel` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `any-sync.syncRepoUrl` | | GitHub sync repo URL or `owner/repo`. When set, all mappings use this repo. |

### Claude Code Plugin

#### Prerequisites

- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [`jq`](https://jqlang.github.io/jq/) installed
- A GitHub repo to store synced files
- Claude Code v1.0.33+

#### Installation

```bash
# Add the marketplace (one-time)
/plugin marketplace add imink/skills-sync-plugin --subdirectory packages/claude-plugin

# Install the plugin
/plugin install any-sync@any-sync-marketplace
```

#### Setup

Run the guided setup wizard inside Claude Code:

```
/any-sync:start
```

This checks your GitHub auth, asks for your sync repo, creates a config with default Claude mappings (skills, memory, settings), and pulls existing files.

#### Commands

| Command | Description |
|---------|-------------|
| `/any-sync:start` | Guided setup wizard |
| `/any-sync:pull` | Pull latest files from GitHub |
| `/any-sync:push` | Push local changes to GitHub |
| `/any-sync:status` | Show sync state and pending changes |
| `/any-sync:reset` | Remove config and lockfile |

#### Automatic Sync

The plugin includes session hooks:
- **Session start** — auto-pulls latest files from GitHub
- **Session end** — auto-pushes any local changes

No manual sync needed for day-to-day use once set up.

## Features

### Core
- **Bidirectional sync** — pull from and push to any GitHub repo directory
- **Incremental sync** — only downloads changed files using SHA-based tracking
- **Conflict resolution** — side-by-side diff view when both local and remote have changed (VS Code) or interactive prompt (Claude Code)
- **Flexible configuration** — sync multiple repos/paths with include/exclude glob patterns
- **Cross-tool compatibility** — same config and lockfile format works in both VS Code and Claude Code

### VS Code Extension
- **7 commands** — pull, push, selective pull/push, init config, reset, show output
- **Status bar** — real-time sync state indicator (idle/syncing/success/error)
- **JSON schema validation** — autocomplete and validation for `.any-sync.json`
- **No git required** — falls back to GitHub REST API when git is not installed
- **Secure auth** — uses VS Code's built-in GitHub authentication with `GITHUB_TOKEN` fallback

### Claude Code Plugin
- **5 slash commands** — start, pull, push, status, reset
- **Session hooks** — automatic pull on session start, push on session end
- **Shell-based** — works anywhere `gh` and `jq` are available, no Node.js required

## Publishing the VS Code Extension

All commands below should be run from the monorepo root.

### Prerequisites

1. Create a publisher account on the [VS Code Marketplace](https://marketplace.visualstudio.com/manage).
2. Generate a Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com) with the **Marketplace > Manage** scope.

### Login

```bash
cd packages/vscode-extension
npx @vscode/vsce login patrickw1029
```

### Package

```bash
npm run package
# Produces packages/vscode-extension/any-sync-<version>.vsix
```

### Publish

```bash
cd packages/vscode-extension
npx @vscode/vsce publish          # publish current version
npx @vscode/vsce publish patch    # bump patch and publish (0.1.9 -> 0.1.10)
npx @vscode/vsce publish minor    # bump minor and publish (0.1.9 -> 0.2.0)
```

### Publish a Pre-packaged VSIX

```bash
cd packages/vscode-extension
npx @vscode/vsce publish --packagePath any-sync-0.1.9.vsix
```

### Unpublish

```bash
npx @vscode/vsce unpublish patrickw1029.any-sync
```

## Development

```bash
# Install all dependencies
npm install

# Build the VS Code extension
npm run build

# Watch mode
npm run watch

# Run VS Code extension tests
npm run test

# Run all package tests
npm run test:all

# Lint
npm run lint
```

## License

MIT
