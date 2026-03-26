# Any Sync

![Any Sync Logo](assets/logo.png)

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/patrickw1029.any-sync?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=patrickw1029.any-sync)

Bidirectional sync between GitHub repositories and local directories. Pull files from any GitHub repo folder to your local workspace, and push changes back via pull requests.

## Features

- **Pull from GitHub**: Download files from any GitHub repo directory to your local workspace
- **Push via PR**: Push local changes back to GitHub through automated pull requests
- **Incremental sync**: Only downloads changed files using SHA-based tracking
- **Conflict resolution**: Side-by-side diff view when both local and remote files have changed
- **Flexible configuration**: Sync multiple repos/paths with include/exclude glob patterns
- **No git required**: Falls back to GitHub REST API when git is not installed
- **Secure auth**: Uses VSCode's built-in GitHub authentication, with `GITHUB_TOKEN` fallback

## Quick Start

1. Install the extension
2. Open a workspace folder
3. Run **"Any Sync: Init or Edit Config"** from the Command Palette (`Cmd+Shift+P`)
4. Edit your mappings in `.any-sync.json`
5. Run **"Any Sync: Pull"** to sync files

## Configuration

Any Sync stores local `.any-sync.json` in VS Code extension storage (outside your repo) so Git will not track it. Use **"Any Sync: Init or Edit Config"** to open it.

The repo used for sync can be controlled globally per workspace using the `any-sync.syncRepoUrl` setting. When this setting is provided, pull and push always use that repo value for all mappings.

- Accepted setting formats:
  - `owner/repo`
  - `https://github.com/owner/repo` (also accepts `.git` suffix)
- If you enter a repo in the first-run prompt, Any Sync saves it into this setting automatically.

Config format:

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

### Mapping options

| Field | Required | Description |
|-------|----------|-------------|
| `name` | ✅ | Human-readable name for this mapping |
| `repo` | ✅ | GitHub repo in `owner/repo` format |
| `branch` | | Branch to sync from (default: repo's default branch) |
| `sourcePath` | ✅ | Path within the repo to sync from |
| `destPath` | ✅ | Local destination (relative to workspace root, or absolute) |
| `include` | | Glob patterns to include (default: all files) |
| `exclude` | | Glob patterns to exclude |

### Path Tokens

You can use path tokens in `destPath` for cross-device mappings:

| Token | Resolves to |
|-------|-------------|
| `${copilotMemory}` | VS Code Copilot memory folder on the current OS |

This token resolves to:
- Windows: `C:\\Users\\<user>\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\memory-tool\\memories`
- macOS: `~/Library/Application Support/Code/User/globalStorage/github.copilot-chat/memory-tool/memories`
- Linux: `~/.config/Code/User/globalStorage/github.copilot-chat/memory-tool/memories`

Example mapping for cross-device Copilot memory sync:

```json
{
  "name": "Copilot Memory",
  "repo": "username/my-repo",
  "branch": "main",
  "sourcePath": "copilot-memory",
  "destPath": "${copilotMemory}",
  "include": ["**/*"],
  "exclude": []
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Any Sync: Pull` | Pull all configured mappings |
| `Any Sync: Pull (Select Mapping)` | Choose which mappings to pull |
| `Any Sync: Push` | Push local changes for all mappings |
| `Any Sync: Push (Select Mapping)` | Choose which mappings to push |
| `Any Sync: Init or Edit Config` | Open local `.any-sync.json` for the current workspace (creates starter config if missing) |
| `Any Sync: Reset Config & Auth` | Remove local Any Sync config and clear Any Sync GitHub auth preference |
| `Any Sync: Show Output` | Open the extension's output channel |

## How it works

### Pull
1. Reads your `.any-sync.json` configuration
2. Fetches the directory tree from GitHub via REST API
3. Compares remote file SHAs against the local lockfile (`.any-sync.lock`)
4. Downloads only changed files, writing them atomically
5. If both local and remote have changed, shows a conflict resolution dialog

### Push
1. Detects locally modified files by comparing content hashes
2. Creates a temporary sparse git checkout (or uses REST API if git unavailable)
3. Pushes changes to a new branch
4. Creates a pull request with a summary of changes

## Authentication

The extension uses VSCode's built-in GitHub authentication by default. When you run a sync command for the first time, VSCode will prompt you to sign in to GitHub.

Alternatively, set the `GITHUB_TOKEN` environment variable for headless/CI scenarios.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `any-sync.logLevel` | `info` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `any-sync.syncRepoUrl` | `` | GitHub sync repository URL or `owner/repo`. Pull and push always use this value when set. |

## Publishing to VS Code Marketplace

### Prerequisites

1. Create a publisher account on the [VS Code Marketplace](https://marketplace.visualstudio.com/manage) if you don't have one.
2. Generate a Personal Access Token (PAT) from [Azure DevOps](https://dev.azure.com) with the **Marketplace > Manage** scope.

### Steps

1. **Login** to your publisher account:
   ```bash
   npx @vscode/vsce login patrickw1029
   ```
   You will be prompted to enter your PAT.

2. **Package** the extension into a `.vsix` file:
   ```bash
   npx @vscode/vsce package
   ```
   This builds and produces a file like `any-sync-0.1.0.vsix`.

3. **Publish** the extension:
   ```bash
   npx @vscode/vsce publish
   ```
   This packages and uploads the extension to the Marketplace in one step.

   To publish a specific version bump:
   ```bash
   npx @vscode/vsce publish minor   # 0.1.0 → 0.2.0
   npx @vscode/vsce publish patch   # 0.1.0 → 0.1.1
   ```

4. **Verify** the extension is live on the [Marketplace](https://marketplace.visualstudio.com/).

### Publishing a Pre-packaged VSIX

If you already have a `.vsix` file:
```bash
npx @vscode/vsce publish --packagePath any-sync-0.1.0.vsix
```

### Unpublish

To remove the extension from the Marketplace:
```bash
npx @vscode/vsce unpublish patrickw1029.any-sync
```

## Requirements

- VSCode 1.85.0 or later
- A GitHub account (for authentication)
- Git (optional, for push via sparse checkout — REST API fallback available)

## License

MIT
