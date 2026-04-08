# Any Sync

Any Sync 是一个跨工具的双向同步插件，通过 GitHub 在不同设备间同步 VS Code、Claude Code 和 OpenClaw 的技能、记忆和配置文件。

<img src="packages/vscode-extension/assets/logo.png" alt="Any Sync Logo" width="128">

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/patrickw1029.any-sync?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync)
[![npm](https://img.shields.io/npm/v/@any-sync/cli?label=npm&logo=npm)](https://www.npmjs.com/package/@any-sync/cli)
[![GitHub Release](https://img.shields.io/github/v/release/imink/any-sync?label=GitHub%20Release&logo=github)](https://github.com/imink/any-sync/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Summary

Any Sync provides bidirectional sync between GitHub repositories and local directories. Pull files from any GitHub repo folder to your local workspace, and push changes back directly.

Supports VS Code, Claude Code, and OpenClaw — all sharing the same config format (`.any-sync.json`) and lockfile (`.any-sync.lock`).

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [`gh` CLI](https://cli.github.com/) installed and authenticated (`gh auth login`)

### One-line setup

```bash
npx @any-sync/cli onboard
```

The wizard will:
1. Check prerequisites (Node.js, `gh` CLI, GitHub auth)
2. Detect your installed tools (Claude Code, OpenClaw, VS Code)
3. Ask for your GitHub sync repo
4. Create config with the right mappings for your tools
5. Pull existing files from GitHub
6. Show plugin install instructions for each detected tool

That's it — you're syncing.

### Non-interactive setup

```bash
# Set up for Claude Code only
npx @any-sync/cli onboard --repo myuser/sync-repo --preset claude

# Set up for multiple tools
npx @any-sync/cli onboard --repo myuser/sync-repo --preset claude --preset openclaw --preset vscode

# Skip initial pull
npx @any-sync/cli onboard --repo myuser/sync-repo --preset claude --no-pull
```

## Features

- **Bidirectional sync** — pull from and push to any GitHub repo directory
- **Incremental sync** — only downloads changed files using SHA-based tracking
- **Conflict resolution** — side-by-side diff view (VS Code) or interactive prompt (Claude Code)
- **Flexible configuration** — sync multiple repos/paths with include/exclude glob patterns
- **Cross-tool compatibility** — same config and lockfile format across all tools

## Tools

### Claude Code Plugin

After running `npx @any-sync/cli onboard`, install the plugin inside Claude Code:

```
/plugin marketplace add imink/any-sync
/plugin install any-sync@any-sync-marketplace
```

Update: `/plugin update any-sync@any-sync-marketplace`

| Command | Description |
|---------|-------------|
| `/any-sync:start` | Guided setup wizard |
| `/any-sync:pull` | Pull latest files from GitHub |
| `/any-sync:push` | Push local changes to GitHub |
| `/any-sync:status` | Show sync state and pending changes |
| `/any-sync:reset` | Remove config and lockfile |

Session hooks auto-pull on start and auto-push on end — no manual sync needed.

### OpenClaw Plugin

After running `npx @any-sync/cli onboard`, install the plugin:

```bash
openclaw plugins install any-sync
```

| Command | Description |
|---------|-------------|
| `/any-sync:start` | Guided setup wizard |
| `/any-sync:pull` | Pull latest files from GitHub |
| `/any-sync:push` | Push local changes to GitHub |
| `/any-sync:status` | Show sync state and pending changes |
| `/any-sync:reset` | Remove config and lockfile |

Session hooks auto-pull on start and auto-push on end. Disable with `autoSync: false`.

Respects `OPENCLAW_PROFILE` for multi-profile workspaces (`~/.openclaw/workspace-<profile>/`).

### VS Code Extension

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync), or via the onboard wizard (`--preset vscode`).

Use the Command Palette (`Cmd+Shift+P`) for all commands: Pull, Push, Init Config, Reset, etc.

The extension uses VS Code's built-in GitHub authentication. Set `GITHUB_TOKEN` for headless/CI scenarios.

## Configuration

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

| Token | Resolves to |
|-------|-------------|
| `${copilotMemory}` | VS Code Copilot memory folder on the current OS |

### Example config

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

## CLI Reference

```bash
npx @any-sync/cli <command> [options]
```

| Command | Description |
|---------|-------------|
| `onboard` | Interactive setup wizard (zero to syncing) |
| `pull` | Pull files from GitHub |
| `push` | Push local changes to GitHub |
| `status` | Show sync status |
| `reset` | Remove config and lockfile |
| `auth` | Check GitHub authentication |
| `init` | Create config file with preset mappings |
| `help` | Show detailed command help |

Run `npx @any-sync/cli help <command>` for command-specific usage.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, building, testing, and publishing instructions.

## License

MIT
