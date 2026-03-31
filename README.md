# Any Sync

<img src="packages/vscode-extension/assets/logo.png" alt="Any Sync Logo" width="128">

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/patrickw1029.any-sync?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync)

## Summary

Any Sync provides bidirectional sync between GitHub repositories and local directories. Pull files from any GitHub repo folder to your local workspace, and push changes back directly.

This monorepo contains three packages:

| Package | Path | Description |
|---------|------|-------------|
| **VS Code Extension** | `packages/vscode-extension` | Full-featured VS Code extension with UI, conflict resolution, and status bar |
| **Claude Code Plugin** | `packages/claude-plugin` | Shell-based plugin for Claude Code with slash commands and automatic session hooks |
| **OpenClaw Plugin** | `packages/openclaw-plugin` | OpenClaw plugin for syncing workspace (skills, memory, AGENTS.md, etc.) via GitHub |

All packages share the same config format (`.any-sync.json`), lockfile (`.any-sync.lock`), and core sync scripts (`packages/shared-scripts`), so you can use any tool interchangeably.

## How to Use

### Quick Comparison

| | VS Code Extension | Claude Code Plugin | OpenClaw Plugin |
|---|---|---|---|
| **Install** | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync) | `/plugin marketplace add imink/skills-sync-plugin --subdirectory packages/claude-plugin` then `/plugin install any-sync@any-sync-marketplace` | `openclaw plugins install any-sync` |
| **Prerequisites** | VS Code | `gh`, `jq`, Claude Code v1.0.33+ | `gh`, `jq`, OpenClaw |
| **Setup** | Command Palette → "Any Sync: Init or Edit Config" | `/any-sync:start` | `/any-sync:start` |
| **Pull** | Command Palette → "Any Sync: Pull" | `/any-sync:pull` | `/any-sync:pull` |
| **Push** | Command Palette → "Any Sync: Push" | `/any-sync:push` | `/any-sync:push` |
| **Status** | Status bar indicator | `/any-sync:status` | `/any-sync:status` |
| **Reset** | Command Palette → "Any Sync: Reset" | `/any-sync:reset` | `/any-sync:reset` |
| **Auto-sync** | Manual | Session hooks (pull on start, push on end) | Session hooks (pull on start, push on end) |
| **Auth** | VS Code GitHub sign-in or `GITHUB_TOKEN` | `gh auth login` or `GITHUB_TOKEN` | `gh auth login` or `GITHUB_TOKEN` |
| **Default sync paths** | Custom (user-configured) | `~/.claude/` (skills, memory, settings) | `~/.openclaw/workspace/` (skills, memory, AGENTS.md, SOUL.md, etc.) |
| **Publish to** | [VS Code Marketplace](https://marketplace.visualstudio.com/) | [Claude Plugin Marketplace](https://github.com/imink/skills-sync-plugin) | [ClawHub](https://clawhub.dev) |

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

### OpenClaw Plugin

#### Prerequisites

- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [`jq`](https://jqlang.github.io/jq/) installed
- A GitHub repo to store synced files
- [OpenClaw](https://docs.openclaw.ai/) installed

#### Installation

```bash
openclaw plugins install any-sync
```

Or install locally for development:

```bash
openclaw plugins install -l ./packages/openclaw-plugin
```

#### Setup

Run the guided setup wizard:

```
/any-sync:start
```

This checks your GitHub auth, asks for your sync repo, and creates a config with default OpenClaw workspace mappings:

| Mapping | Repo path | Local path |
|---------|-----------|------------|
| `workspace-skills` | `skills/` | `~/.openclaw/workspace/skills/` |
| `workspace-memory` | `memory/` | `~/.openclaw/workspace/memory/` |
| `workspace-config` | `config/` | `~/.openclaw/workspace/` (AGENTS.md, SOUL.md, USER.md, TOOLS.md, IDENTITY.md) |

If `OPENCLAW_PROFILE` is set, the workspace path adjusts to `~/.openclaw/workspace-<profile>/`.

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

Disable auto-sync by setting `autoSync: false` in the plugin config.

#### Publishing

The plugin is published to [ClawHub](https://clawhub.dev):

```bash
clawhub package publish ./packages/openclaw-plugin \
  --name any-sync \
  --family code-plugin \
  --source-repo imink/skills-sync-plugin \
  --source-commit $(git rev-parse HEAD) \
  --source-ref main \
  --source-path packages/openclaw-plugin
```

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

### OpenClaw Plugin
- **5 slash commands** — start, pull, push, status, reset
- **Session hooks** — automatic pull on session start, push on session end
- **Profile-aware** — respects `OPENCLAW_PROFILE` for multi-profile workspaces
- **ClawHub published** — install with `openclaw plugins install any-sync`

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
