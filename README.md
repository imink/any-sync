# Any Sync

Any Sync 是一个跨工具的双向同步插件，通过 GitHub 在不同设备间同步 VS Code、Claude Code 和 OpenClaw 的技能、记忆和配置文件。

<img src="packages/vscode-extension/assets/logo.png" alt="Any Sync Logo" width="128">

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/patrickw1029.any-sync?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync)
[![npm](https://img.shields.io/npm/v/@any-sync/cli?label=npm&logo=npm)](https://www.npmjs.com/package/@any-sync/cli)
[![GitHub Release](https://img.shields.io/github/v/release/imink/any-sync?label=GitHub%20Release&logo=github)](https://github.com/imink/any-sync/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Summary

Any Sync provides bidirectional sync between GitHub repositories and local directories. Pull files from any GitHub repo folder to your local workspace, and push changes back directly.

Supported tools:

| Package | Description |
|---------|-------------|
| **VS Code Extension** | Full-featured VS Code extension with UI, conflict resolution, and status bar |
| **Claude Code Plugin** | Plugin for Claude Code with slash commands and automatic session hooks |
| **OpenClaw Plugin** | OpenClaw plugin for syncing workspace (skills, memory, AGENTS.md, etc.) via GitHub |
| **CLI** | Core sync engine and CLI (`any-sync pull/push/status/reset/auth/init`) |

All packages share the same config format (`.any-sync.json`), lockfile (`.any-sync.lock`), and core CLI (`@any-sync/cli`), so you can use any tool interchangeably.

## Features

- **Bidirectional sync** — pull from and push to any GitHub repo directory
- **Incremental sync** — only downloads changed files using SHA-based tracking
- **Conflict resolution** — side-by-side diff view (VS Code) or interactive prompt (Claude Code)
- **Flexible configuration** — sync multiple repos/paths with include/exclude glob patterns
- **Cross-tool compatibility** — same config and lockfile format across all tools

## Quick Comparison

| | VS Code Extension | Claude Code Plugin | OpenClaw Plugin |
|---|---|---|---|
| **Install** | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync) | `/plugin marketplace add imink/any-sync` then `/plugin install any-sync@any-sync-marketplace` | `openclaw plugins install any-sync` |
| **Prerequisites** | VS Code | `gh`, Node.js, Claude Code v1.0.33+ | `gh`, Node.js, OpenClaw |
| **Setup** | Command Palette → "Any Sync: Init or Edit Config" | `/any-sync:start` | `/any-sync:start` |
| **Pull** | Command Palette → "Any Sync: Pull" | `/any-sync:pull` | `/any-sync:pull` |
| **Push** | Command Palette → "Any Sync: Push" | `/any-sync:push` | `/any-sync:push` |
| **Status** | Status bar indicator | `/any-sync:status` | `/any-sync:status` |
| **Reset** | Command Palette → "Any Sync: Reset" | `/any-sync:reset` | `/any-sync:reset` |
| **Auto-sync** | Manual | Session hooks (pull on start, push on end) | Session hooks (pull on start, push on end) |
| **Auth** | VS Code GitHub sign-in or `GITHUB_TOKEN` | `gh auth login` or `GITHUB_TOKEN` | `gh auth login` or `GITHUB_TOKEN` |
| **Default sync paths** | Custom (user-configured) | `~/.claude/` (skills, memory, settings) | `~/.openclaw/workspace/` (skills, memory, AGENTS.md, SOUL.md, etc.) |

## VS Code Extension

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync).
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

### Mapping Options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable name for this mapping |
| `repo` | Yes | GitHub repo in `owner/repo` format |
| `branch` | | Branch to sync from/push to (default: `main`) |
| `sourcePath` | Yes | Path within the repo to sync from |
| `destPath` | Yes | Local destination (relative to workspace root, or absolute) |
| `include` | | Glob patterns to include (default: all files) |
| `exclude` | | Glob patterns to exclude |

### Path Tokens

Use tokens in `destPath` for cross-device mappings:

| Token | Resolves to |
|-------|-------------|
| `${copilotMemory}` | VS Code Copilot memory folder on the current OS |

### Authentication

The extension uses VS Code's built-in GitHub authentication. On first run, VS Code will prompt you to sign in. Alternatively, set the `GITHUB_TOKEN` environment variable for headless/CI scenarios.

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `any-sync.logLevel` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `any-sync.syncRepoUrl` | | GitHub sync repo URL or `owner/repo`. When set, all mappings use this repo. |

### VS Code Features

- **7 commands** — pull, push, selective pull/push, init config, reset, show output
- **Status bar** — real-time sync state indicator (idle/syncing/success/error)
- **JSON schema validation** — autocomplete and validation for `.any-sync.json`
- **No git required** — falls back to GitHub REST API when git is not installed
- **Secure auth** — uses VS Code's built-in GitHub authentication with `GITHUB_TOKEN` fallback

## Claude Code Plugin

### Prerequisites

- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [Node.js](https://nodejs.org/) (v18+)
- A GitHub repo to store synced files
- Claude Code v1.0.33+

### Installation

```bash
# Add the marketplace (one-time)
/plugin marketplace add imink/any-sync

# Install the plugin
/plugin install any-sync@any-sync-marketplace
```

### Update

```bash
/plugin update any-sync@any-sync-marketplace
```

### Setup

Run the guided setup wizard inside Claude Code:

```
/any-sync:start
```

This checks your GitHub auth, asks for your sync repo, creates a config with default Claude mappings (skills, memory, settings), and pulls existing files.

### Commands

| Command | Description |
|---------|-------------|
| `/any-sync:start` | Guided setup wizard |
| `/any-sync:pull` | Pull latest files from GitHub |
| `/any-sync:push` | Push local changes to GitHub |
| `/any-sync:status` | Show sync state and pending changes |
| `/any-sync:reset` | Remove config and lockfile |

### Automatic Sync

The plugin includes session hooks:
- **Session start** — auto-pulls latest files from GitHub
- **Session end** — auto-pushes any local changes

No manual sync needed for day-to-day use once set up.

## OpenClaw Plugin

### Prerequisites

- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)
- [Node.js](https://nodejs.org/) (v18+)
- A GitHub repo to store synced files
- [OpenClaw](https://docs.openclaw.ai/) installed

### Installation

```bash
openclaw plugins install any-sync
```

### Setup

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

### Commands

| Command | Description |
|---------|-------------|
| `/any-sync:start` | Guided setup wizard |
| `/any-sync:pull` | Pull latest files from GitHub |
| `/any-sync:push` | Push local changes to GitHub |
| `/any-sync:status` | Show sync state and pending changes |
| `/any-sync:reset` | Remove config and lockfile |

### Automatic Sync

The plugin includes session hooks:
- **Session start** — auto-pulls latest files from GitHub
- **Session end** — auto-pushes any local changes

Disable auto-sync by setting `autoSync: false` in the plugin config.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building, testing, and publishing instructions.

## License

MIT
