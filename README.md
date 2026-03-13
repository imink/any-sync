# Any Sync

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
3. Run **"Any Sync: Init Config"** from the Command Palette (`Cmd+Shift+P`)
4. Edit `.any-sync.json` to configure your sync mappings
5. Run **"Any Sync: Pull"** to sync files

## Configuration

Create a `.any-sync.json` file in your workspace root:

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

## Commands

| Command | Description |
|---------|-------------|
| `Any Sync: Pull` | Pull all configured mappings |
| `Any Sync: Pull (Select Mapping)` | Choose which mappings to pull |
| `Any Sync: Push` | Push local changes for all mappings |
| `Any Sync: Push (Select Mapping)` | Choose which mappings to push |
| `Any Sync: Init Config` | Create a starter `.any-sync.json` |
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

## Requirements

- VSCode 1.85.0 or later
- A GitHub account (for authentication)
- Git (optional, for push via sparse checkout — REST API fallback available)

## License

MIT
